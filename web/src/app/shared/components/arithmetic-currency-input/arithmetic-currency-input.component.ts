import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { CurrencyService } from '../../../services/currency.service';
import { evaluateExpression, formatCentsForDisplay } from '../../utils/arithmetic-input-state';
import { getCurrencyFormat } from '../../utils/currency';

/**
 * ArithmeticCurrencyInputComponent
 *
 * A free-form currency input component that supports arithmetic expressions.
 * Users can type supported expression characters (e.g., "100+50", "100 + 50 * 2", "(100+50)*2").
 * Expressions are evaluated on Enter or blur.
 * Invalid expressions are ignored (previous value is preserved).
 */
@Component({
  selector: 'app-arithmetic-currency-input',
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <input
      #inputElement
      type="text"
      inputmode="decimal"
      [value]="inputText()"
      [placeholder]="placeholder()"
      [disabled]="disabled()"
      [class]="inputClass()"
      (keydown)="onKeydown($event)"
      (input)="onInput($event)"
      (focus)="onFocus()"
      (blur)="onBlur()"
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
export class ArithmeticCurrencyInputComponent implements AfterViewInit {
  private readonly currencyService = inject(CurrencyService);

  // Component inputs
  readonly initialValue = input<number | null>(null);
  readonly currency = input<string | undefined>(undefined);
  readonly placeholderInput = input<string | undefined>(undefined);
  readonly disabled = input<boolean>(false);
  readonly inputClass = input<string>('');
  readonly autoFocus = input<boolean>(false);
  readonly allowNegative = input<boolean>(true);

  // Component outputs
  readonly valueChange = output<number>();
  readonly enterPressed = output<void>();
  readonly blurEvent = output<void>();

  // View children
  readonly inputElement = viewChild<ElementRef<HTMLInputElement>>('inputElement');

  // Internal state - simple text input
  readonly inputText = signal<string>('');

  // Track last valid value (for when expression is invalid)
  private lastValidValue: number | null = null;

  // Currency format computed from input or defaults to workspace currency
  private readonly currencyFormat = computed(() => {
    const currencyCode = this.currency() ?? this.currencyService.currencyCode();
    return getCurrencyFormat(currencyCode);
  });

  // Dynamic placeholder based on currency format
  protected readonly placeholder = computed(() => {
    if (this.placeholderInput()) {
      return this.placeholderInput()!;
    }
    const format = this.currencyFormat();
    const numberPart = format.decimalPlaces === 0 ? '0' : '0.' + '0'.repeat(format.decimalPlaces);
    return numberPart;
  });

  constructor() {
    // Initialize input text when initial value changes
    effect(() => {
      const initial = this.initialValue();
      const format = this.currencyFormat();

      if (initial !== null) {
        this.lastValidValue = initial;
        this.inputText.set(formatCentsForDisplay(initial, format.decimalPlaces));
      } else {
        this.lastValidValue = null;
        this.inputText.set('');
      }
    });
  }

  ngAfterViewInit(): void {
    if (this.autoFocus()) {
      setTimeout(() => {
        this.inputElement()?.nativeElement.focus();
        this.inputElement()?.nativeElement.select();
      });
    }
  }

  /**
   * Sets the value programmatically (used by quick action buttons)
   * Formats the value for display
   */
  setValue(cents: number): void {
    const format = this.currencyFormat();
    this.lastValidValue = cents;
    this.inputText.set(formatCentsForDisplay(cents, format.decimalPlaces));
  }

  /**
   * Sets the input text directly (for raw text input)
   */
  setInputText(text: string): void {
    this.inputText.set(text);
  }

  /**
   * Gets the current input text
   */
  getInputText(): string {
    return this.inputText();
  }

  /**
   * Gets the current evaluated value (or last valid value if current expression is invalid)
   */
  getValue(): number {
    const result = evaluateExpression(this.inputText(), this.currencyFormat().decimalPlaces);
    return result ?? this.lastValidValue ?? 0;
  }

  /**
   * Focus the input element
   */
  focus(): void {
    this.inputElement()?.nativeElement.focus();
  }

  // Event handlers

  protected onKeydown(event: KeyboardEvent): void {
    // Handle Enter key - evaluate and emit
    if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      this.evaluateAndEmit();
      this.enterPressed.emit();
      return;
    }

    // Handle Escape - let it bubble up
    if (event.key === 'Escape') {
      return;
    }

    if (this.isShortcutKey(event) || this.isEditingKey(event.key)) {
      return;
    }

    if (event.key.length === 1 && !this.isAllowedExpressionCharacter(event.key)) {
      event.preventDefault();
    }
  }

  protected onInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const sanitizedValue = this.sanitizeExpressionInput(input.value);

    if (input.value !== sanitizedValue) {
      input.value = sanitizedValue;
    }

    this.inputText.set(sanitizedValue);
  }

  protected onFocus(): void {
    this.inputElement()?.nativeElement.select();
  }

  protected onBlur(): void {
    this.evaluateAndEmit();
    this.blurEvent.emit();
  }

  /**
   * Evaluate the current expression and emit the result.
   * If the expression is invalid, do nothing (keep previous value).
   */
  private evaluateAndEmit(): void {
    const format = this.currencyFormat();
    let result = evaluateExpression(this.inputText(), format.decimalPlaces);

    if (result !== null) {
      if (!this.allowNegative()) {
        result = Math.abs(result);
      }
      this.lastValidValue = result;
      this.valueChange.emit(result);
      // Update display to formatted result
      this.inputText.set(formatCentsForDisplay(result, format.decimalPlaces));
    }
    // If result is null (invalid expression), don't emit anything
    // The popover will close and the previous value is preserved
  }

  private isShortcutKey(event: KeyboardEvent): boolean {
    return event.metaKey || event.ctrlKey;
  }

  private isEditingKey(key: string): boolean {
    return ['Backspace', 'Delete', 'Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(
      key
    );
  }

  private sanitizeExpressionInput(value: string): string {
    return Array.from(value)
      .filter((char) => this.isAllowedExpressionCharacter(char))
      .join('');
  }

  private isAllowedExpressionCharacter(char: string): boolean {
    return /[0-9+\-*/().\s]/.test(char);
  }
}
