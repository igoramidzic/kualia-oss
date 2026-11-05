import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { BrnComboboxImports } from '@spartan-ng/brain/combobox';
import { BrnPopoverContent } from '@spartan-ng/brain/popover';
import { HlmComboboxImports } from '@spartan-ng/helm/combobox';
import {
  nucleoCheckCircle as CircleCheck,
  nucleoPause as CirclePause,
  nucleoHistory as ClockFading,
  NucleoIcon,
  type NucleoIconData,
} from '@kualia/icons';

interface StatusOption {
  value: string;
  label: string;
  icon: NucleoIconData;
}

@Component({
  selector: 'app-status-selector',
  imports: [NucleoIcon, BrnComboboxImports, BrnPopoverContent, HlmComboboxImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-combobox [value]="status()" (valueChange)="selectStatus($event)" [disabled]="disabled()" sideOffset="5">
      <hlm-combobox-trigger [class]="buttonClass()" [variant]="variant()" [showIcon]="false" stopPropagation>
        <span class="flex items-center gap-2">
          <nucleo-icon
            [icon]="selectedOption().icon"
            [size]="16"
            [class.text-green-500]="status() === 'active' || status() === 'completed'"
            [class.text-gray-500]="status() === 'paused'"
          />
          <span>{{ selectedOption().label }}</span>
        </span>
      </hlm-combobox-trigger>
      <div *brnPopoverContent hlmComboboxContent class="w-[150px]">
        <div hlmComboboxList>
          <div hlmComboboxGroup>
            @for (option of statusOptions(); track option.value) {
              <hlm-combobox-item [value]="option.value">
                <div class="flex items-center gap-2">
                  <nucleo-icon
                    [icon]="option.icon"
                    [size]="16"
                    [class.text-green-500]="option.value === 'active' || option.value === 'completed'"
                    [class.text-gray-500]="option.value === 'paused'"
                  />
                  <span>{{ option.label }}</span>
                </div>
              </hlm-combobox-item>
            }
          </div>
        </div>
      </div>
    </hlm-combobox>
  `,
})
export class StatusSelectorComponent {
  // Inputs
  readonly status = input<'active' | 'paused' | 'completed'>('active');
  readonly disabled = input<boolean>(false);
  readonly variant = input<'outline' | 'ghost'>('ghost');
  readonly buttonClass = input<string>('w-fit justify-between text-xs');

  // Output
  readonly statusChange = output<'active' | 'paused'>();

  // Icons
  readonly activeIcon = ClockFading;
  readonly pauseIcon = CirclePause;
  readonly completedIcon = CircleCheck;

  // All possible status options (including completed for display)
  readonly allStatusOptions: StatusOption[] = [
    { value: 'active', label: 'Active', icon: this.activeIcon },
    { value: 'paused', label: 'Paused', icon: this.pauseIcon },
    { value: 'completed', label: 'Completed', icon: this.completedIcon },
  ];

  // Selectable status options (excludes completed)
  readonly statusOptions = computed(() => {
    return this.allStatusOptions.filter((option) => option.value !== 'completed');
  });

  // Computed values
  readonly selectedOption = computed(() => {
    const currentStatus = this.status();
    return this.allStatusOptions.find((option) => option.value === currentStatus) ?? this.allStatusOptions[0];
  });

  selectStatus(status: string | null | undefined) {
    if (status === 'active' || status === 'paused') {
      this.statusChange.emit(status);
    }
  }
}
