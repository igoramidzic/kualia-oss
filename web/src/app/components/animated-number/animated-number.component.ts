import { ChangeDetectionStrategy, Component, computed, effect, input, signal } from '@angular/core';

@Component({
  selector: 'app-animated-number',
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="inline-flex items-baseline">
      @for (digit of displayDigits(); track $index) {
        @if (digit.type === 'digit') {
          <span class="digit-wrapper">
            <span class="digit-column" [style.transform]="'translateY(' + digit.offset + '%)'">
              @for (num of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]; track num) {
                <span class="digit">{{ num }}</span>
              }
            </span>
          </span>
        } @else {
          <span class="non-digit">{{ digit.char }}</span>
        }
      }
    </span>
  `,
  styles: [
    `
      :host {
        display: inline-block;
        font-variant-numeric: tabular-nums;
      }

      .digit-wrapper {
        display: inline-block;
        overflow: hidden;
        height: 1em;
        min-width: 0.65em;
        line-height: 1em;
        position: relative;
        vertical-align: baseline;
      }

      .digit-column {
        display: flex;
        flex-direction: column;
        transition: transform 0.5s cubic-bezier(0.4, 0, 0.2, 1);
        will-change: transform;
      }

      .digit {
        display: block;
        height: 1em;
        line-height: 1em;
        width: 100%;
      }

      .non-digit {
        display: inline-block;
      }
    `,
  ],
})
export class AnimatedNumberComponent {
  readonly value = input.required<number>();
  readonly duration = input<number>(100);

  private readonly currentValue = signal<number>(0);
  private readonly targetValue = signal<number>(0);
  private animationFrame: number | null = null;
  private isFirstRun = true;

  readonly displayDigits = computed(() => {
    const val = this.currentValue();
    const str = val.toFixed(0);
    const digits = str.split('').map((char) => {
      if (/\d/.test(char)) {
        const digit = parseInt(char, 10);
        // Column has 10 digits (0-9), so each digit is 10% of the column height
        const offset = -digit * 10;
        return {
          type: 'digit' as const,
          char,
          offset: offset,
        };
      }
      return {
        type: 'other' as const,
        char,
        offset: 0,
      };
    });
    return digits;
  });

  constructor() {
    effect(() => {
      const newValue = this.value();

      // Handle invalid values
      if (newValue === null || newValue === undefined || isNaN(newValue)) {
        this.currentValue.set(0);
        this.targetValue.set(0);
        return;
      }

      // On first run, set value immediately without animation
      if (this.isFirstRun) {
        this.isFirstRun = false;
        this.currentValue.set(newValue);
        this.targetValue.set(newValue);
        return;
      }

      this.targetValue.set(newValue);
      this.animateToTarget();
    });
  }

  private animateToTarget(): void {
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
    }

    const start = this.currentValue();
    const end = this.targetValue();
    const startTime = performance.now();
    const duration = this.duration();

    const animate = (currentTime: number): void => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Ease out cubic
      const easeProgress = 1 - Math.pow(1 - progress, 3);

      const current = start + (end - start) * easeProgress;
      this.currentValue.set(Math.round(current));

      if (progress < 1) {
        this.animationFrame = requestAnimationFrame(animate);
      } else {
        this.animationFrame = null;
      }
    };

    this.animationFrame = requestAnimationFrame(animate);
  }
}
