import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { SelectionCardComponent } from '../components/selection-card.component';
import { TRANSPORTATION_OPTIONS, type TransportationType } from '../types';

@Component({
  selector: 'app-transportation-step',
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
export class TransportationStepComponent {
  protected readonly options = TRANSPORTATION_OPTIONS;

  readonly transportation = input<TransportationType[]>([]);
  readonly transportationChange = output<TransportationType[]>();

  isSelected(value: TransportationType): boolean {
    return this.transportation().includes(value);
  }

  onToggle(value: TransportationType): void {
    const current = this.transportation();
    if (current.includes(value)) {
      this.transportationChange.emit(current.filter((v) => v !== value));
    } else {
      this.transportationChange.emit([...current, value]);
    }
  }
}
