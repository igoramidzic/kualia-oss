import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { SelectionCardComponent } from '../components/selection-card.component';
import { HOUSEHOLD_OPTIONS, type HouseholdType } from '../types';

@Component({
  selector: 'app-household-step',
  imports: [SelectionCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-4">
      @for (option of options; track option.value) {
        <app-selection-card
          [title]="option.title"
          [description]="option.description"
          [icon]="option.icon"
          [selected]="isSelected(option.value)"
          selectionType="multi"
          (selectedChange)="onToggle(option.value)"
        />
      }
    </div>
  `,
})
export class HouseholdStepComponent {
  protected readonly options = HOUSEHOLD_OPTIONS;

  readonly household = input<HouseholdType[]>([]);
  readonly householdChange = output<HouseholdType[]>();

  isSelected(value: HouseholdType): boolean {
    return this.household().includes(value);
  }

  onToggle(value: HouseholdType): void {
    const current = this.household();
    if (current.includes(value)) {
      this.householdChange.emit(current.filter((v) => v !== value));
    } else {
      this.householdChange.emit([...current, value]);
    }
  }
}
