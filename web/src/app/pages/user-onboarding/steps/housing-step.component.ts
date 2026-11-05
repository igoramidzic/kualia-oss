import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { SelectionCardComponent } from '../components/selection-card.component';
import { HOUSING_OPTIONS, type HousingType } from '../types';

@Component({
  selector: 'app-housing-step',
  imports: [SelectionCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-4">
      @for (option of options; track option.value) {
        <app-selection-card
          [title]="option.title"
          [description]="option.description"
          [icon]="option.icon"
          [selected]="housing() === option.value"
          selectionType="single"
          (selectedChange)="onSelect(option.value)"
        />
      }
    </div>
  `,
})
export class HousingStepComponent {
  protected readonly options = HOUSING_OPTIONS;

  readonly housing = input<HousingType | null>(null);
  readonly housingChange = output<HousingType>();

  onSelect(value: HousingType): void {
    this.housingChange.emit(value);
  }
}
