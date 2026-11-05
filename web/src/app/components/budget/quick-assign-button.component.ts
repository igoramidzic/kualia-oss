import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmSwitch } from '@spartan-ng/helm/switch';
import { CurrencyService } from '../../services/currency.service';

@Component({
  selector: 'app-quick-assign-button',
  imports: [HlmButton, HlmSwitch],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block',
  },
  template: `
    <button
      hlmBtn
      variant="secondary"
      size="sm"
      class="flex h-8 w-full items-center justify-between"
      [disabled]="disabled()"
      (click)="onClick()"
    >
      <span [class]="labelClass()">{{ label() }}</span>
      @if (isEditMode()) {
        <hlm-switch
          [class]="switchClass()"
          [checked]="switchChecked()"
          [disabled]="switchDisabled()"
          (checkedChange)="onSwitchChange($event)"
        />
      } @else {
        @if (amount() !== null) {
          <span class="min-w-0 truncate text-right">{{ formatAmount(amount()!) }}</span>
        }
      }
    </button>
  `,
})
export class QuickAssignButtonComponent {
  private readonly currencyService = inject(CurrencyService);

  readonly label = input.required<string>();
  readonly amount = input<bigint | null>(null);
  readonly disabled = input<boolean>(false);
  readonly isEditMode = input<boolean>(false);
  readonly switchChecked = input<boolean>(false);
  readonly switchDisabled = input<boolean>(false);
  readonly switchClass = input<string>('');
  readonly labelClass = input<string>('flex-shrink-0 font-medium');

  readonly clicked = output<void>();
  readonly switchChanged = output<boolean>();

  formatAmount(amount: bigint): string {
    return this.currencyService.format(amount);
  }

  onClick(): void {
    this.clicked.emit();
  }

  onSwitchChange(checked: boolean): void {
    this.switchChanged.emit(checked);
  }
}
