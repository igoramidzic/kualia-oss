import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { SelectionCardComponent } from '../components/selection-card.component';
import { FINANCIAL_GOALS_OPTIONS, type FinancialGoal } from '../types';

@Component({
  selector: 'app-financial-goals-step',
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
export class FinancialGoalsStepComponent {
  protected readonly options = FINANCIAL_GOALS_OPTIONS;

  readonly financialGoals = input<FinancialGoal[]>([]);
  readonly financialGoalsChange = output<FinancialGoal[]>();

  isSelected(value: FinancialGoal): boolean {
    return this.financialGoals().includes(value);
  }

  onToggle(value: FinancialGoal): void {
    const current = this.financialGoals();
    if (current.includes(value)) {
      this.financialGoalsChange.emit(current.filter((v) => v !== value));
    } else {
      this.financialGoalsChange.emit([...current, value]);
    }
  }
}
