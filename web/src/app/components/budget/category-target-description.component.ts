import { ChangeDetectionStrategy, Component, computed, inject, input, SecurityContext, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { nucleoChevronDown as ChevronDown, nucleoInfo as Info, NucleoIcon } from '@kualia/icons';
import { CurrencyService } from '../../services/currency.service';
import { formatDateForDisplay, formatDateToString } from '../../shared/utils/date-utils';
import { TargetTypeSelection } from './target-type-toggle.component';

type Frequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

@Component({
  selector: 'app-category-target-description',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NucleoIcon],
  template: `
    <div class="border-border rounded-lg border p-2">
      <button type="button" class="flex w-full items-center gap-3 text-left" (click)="toggleOpen()">
        <nucleo-icon [icon]="Info" size="14" class="text-primary shrink-0" />
        <h1 class="text-primary flex-1 text-xs">How it works</h1>
        <nucleo-icon
          [icon]="ChevronDown"
          size="16"
          class="text-primary shrink-0 transition-transform duration-200"
          [class.rotate-180]="isOpen()"
        />
      </button>
      <div
        class="grid transition-all duration-200 ease-in-out"
        [class.grid-rows-[1fr]]="isOpen()"
        [class.grid-rows-[0fr]]="!isOpen()"
      >
        <div class="overflow-hidden">
          <div class="pt-2 pl-7">
            <span class="text-primary text-xs leading-4.5" [innerHTML]="description()"></span>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class CategoryTargetDescriptionComponent {
  protected readonly Info = Info;
  protected readonly ChevronDown = ChevronDown;

  private readonly currencyService = inject(CurrencyService);
  private readonly sanitizer = inject(DomSanitizer);

  // Collapsible state
  protected readonly isOpen = signal(false);

  protected toggleOpen(): void {
    this.isOpen.update((v) => !v);
  }

  // Inputs
  targetType = input.required<TargetTypeSelection>();
  amount = input.required<bigint>();
  frequency = input<Frequency>();
  frequencyInterval = input<number>();
  dayOfWeek = input<number | undefined>();
  dueDay = input<number | undefined>();
  firstDueDate = input<Date | undefined>();
  targetDate = input<Date | undefined>();
  monthlyContribution = input<bigint>();

  // Main computed description
  protected readonly description = computed<SafeHtml>(() => {
    const html = this.generateDescription();
    return this.sanitizer.sanitize(SecurityContext.HTML, html) ?? '';
  });

  private generateDescription(): string {
    const type = this.targetType();
    switch (type) {
      case 'one_time':
        return this.generateOneTimeDescription();
      case 'set_aside':
        return this.generateRecurringDescription('Set aside');
      case 'fill_up':
        return this.generateRecurringDescription('Fill up to');
      case 'maintain_balance':
        return this.generateMaintainBalanceDescription();
      default:
        return '';
    }
  }

  private generateOneTimeDescription(): string {
    const amount = this.formatCurrencyBold(this.amount());
    const target = this.targetDate();

    if (!target) {
      return `Tracks your progress toward your goal, showing if you're on pace to reach ${amount}.`;
    }

    const dateStr = this.formatDateBold(target);
    return `Tracks your progress and keeps you on pace to reach ${amount} by ${dateStr}. If you spend before the due date, your monthly contribution will increase to cover the premature spending.`;
  }

  private generateRecurringDescription(verb: string): string {
    const amount = this.formatCurrencyBold(this.amount());
    const freq = this.frequency();
    const interval = this.frequencyInterval();

    if (!freq || !interval) return '';

    const freqLabel = this.getFrequencyLabel(freq, interval);
    const freqPhrase = interval === 1 ? `every ${freqLabel}` : `every ${interval} ${freqLabel}`;

    if (verb === 'Set aside') {
      return `Budgets another ${amount} ${freqPhrase}, regardless of carry over from previous period.`;
    } else {
      // Fill up to
      return `Tops up to ${amount} ${freqPhrase}. Uses the carry over from the previous month to budget only what's needed to reach the target.`;
    }
  }

  private generateMaintainBalanceDescription(): string {
    const balance = this.formatCurrencyBold(this.amount());
    const contrib = this.formatCurrencyBold(this.monthlyContribution() ?? 0n);

    return `Adds ${contrib} each month and rolls over any unused amount to maintain ${balance} available. Stops budgeting when the target is reached.`;
  }

  // Helper methods
  private formatCurrencyBold(amount: bigint): string {
    const formatted = this.currencyService.format(amount);
    const className = amount === 0n ? 'text-muted-foreground' : '';
    return `<strong class="${className}">${formatted}</strong>`;
  }

  private formatDateBold(date: Date): string {
    const formatted = formatDateForDisplay(formatDateToString(date));
    return `<strong>${formatted}</strong>`;
  }

  private getDayOfWeekName(dow: number): string {
    const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return names[dow] ?? '';
  }

  private getFrequencyLabel(freq: Frequency, interval: number): string {
    const labels: Record<Frequency, string> = {
      daily: interval === 1 ? 'day' : 'days',
      weekly: interval === 1 ? 'week' : 'weeks',
      monthly: interval === 1 ? 'month' : 'months',
      yearly: interval === 1 ? 'year' : 'years',
    };
    return labels[freq];
  }
}
