import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HlmButton } from '@spartan-ng/helm/button';
import { nucleoArrowLeft as ArrowLeft, nucleoArrowRight as ArrowRight, NucleoIcon } from '@kualia/icons';

@Component({
  selector: 'app-month-navigation',
  imports: [NucleoIcon, HlmButton, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './month-navigation.component.html',
})
export class MonthNavigationComponent {
  protected readonly ArrowLeft = ArrowLeft;
  protected readonly ArrowRight = ArrowRight;

  selectedMonth = input.required<string>();
  previousMonthParam = input.required<string>();
  nextMonthParam = input.required<string>();
  isCurrentMonth = input.required<boolean>();

  readonly monthDisplay = computed(() => {
    const month = this.selectedMonth();
    // Parse YYYY-MM format to avoid timezone issues
    const [yearStr, monthStr] = month.split('-');
    const year = parseInt(yearStr, 10);
    const monthNum = parseInt(monthStr, 10);

    // Create date explicitly in local timezone
    const date = new Date(year, monthNum - 1, 1); // month is 0-indexed in Date constructor
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  });
}
