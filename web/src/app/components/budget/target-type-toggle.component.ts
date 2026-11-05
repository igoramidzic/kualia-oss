import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { BrnPopover, BrnPopoverContent, BrnPopoverTrigger } from '@spartan-ng/brain/popover';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmPopoverContent } from '@spartan-ng/helm/popover';
import { nucleoCheck as Check, nucleoChevronDown as ChevronDown, NucleoIcon } from '@kualia/icons';
import { CurrencyService } from '../../services/currency.service';

export type TargetTypeSelection = 'set_aside' | 'fill_up' | 'maintain_balance' | 'one_time';

interface TargetTypeOption {
  value: TargetTypeSelection;
  label: string;
  description: string;
}

@Component({
  selector: 'app-target-type-toggle',
  imports: [BrnPopover, BrnPopoverContent, BrnPopoverTrigger, HlmButton, HlmPopoverContent, NucleoIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <brn-popover [state]="popoverState()" (stateChanged)="popoverState.set($event)" sideOffset="5">
      <button
        type="button"
        hlmBtn
        variant="ghost"
        size="sm"
        class="h-8 justify-between px-1 text-xs"
        [disabled]="disabled()"
        brnPopoverTrigger
      >
        <span class="min-w-0 flex-1 truncate text-left">
          {{ selectedOption()?.label ?? 'Select target type...' }}
        </span>
        <nucleo-icon [icon]="ChevronDown" [size]="14" class="text-muted-foreground flex-shrink-0" />
      </button>
      <div *brnPopoverContent hlmPopoverContent class="w-80 p-0">
        @for (option of options(); track option.value) {
          <button
            type="button"
            class="hover:bg-accent flex w-full items-start gap-3 border-b px-4 py-3 text-left transition-colors last:border-b-0"
            (click)="selectOption(option.value)"
          >
            <div class="min-w-0 flex-1">
              <div class="mb-1 text-sm font-medium">{{ option.label }}</div>
              <div class="text-muted-foreground text-xs">{{ option.description }}</div>
            </div>
            @if (value() === option.value) {
              <nucleo-icon [icon]="Check" [size]="16" class="text-primary mt-0.5 flex-shrink-0" />
            }
          </button>
        }
      </div>
    </brn-popover>
  `,
})
export class TargetTypeToggleComponent {
  private readonly currencyService = inject(CurrencyService);

  readonly value = input<TargetTypeSelection>('set_aside');
  readonly disabled = input<boolean>(false);
  readonly amount = input<bigint>(0n);

  readonly valueChange = output<TargetTypeSelection>();

  protected readonly popoverState = signal<'open' | 'closed'>('closed');

  protected readonly Check = Check;
  protected readonly ChevronDown = ChevronDown;

  protected readonly options = computed<TargetTypeOption[]>(() => {
    const formattedAmount = this.currencyService.format(this.amount());
    return [
      {
        value: 'set_aside',
        label: `Set aside ${formattedAmount}`,
        description: 'Use for: bills, subscriptions, saving over time',
      },
      {
        value: 'fill_up',
        label: `Fill up to ${formattedAmount}`,
        description: 'Use for: gasoline, fun money, dining out',
      },
      {
        value: 'maintain_balance',
        label: `Maintain balance of ${formattedAmount}`,
        description: 'Use for: long-term savings',
      },
      {
        value: 'one_time',
        label: `One-time goal of ${formattedAmount}`,
        description: 'Save towards a specific goal by a deadline',
      },
    ];
  });

  protected readonly selectedOption = computed(() => {
    const val = this.value();
    return this.options().find((opt) => opt.value === val);
  });

  selectOption(value: TargetTypeSelection): void {
    this.valueChange.emit(value);
    this.popoverState.set('closed');
  }
}
