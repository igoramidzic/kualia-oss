import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { NucleoIconData } from '@kualia/icons';
import { nucleoCheck as Check, NucleoIcon } from '@kualia/icons';

@Component({
  selector: 'app-selection-card',
  imports: [NucleoIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="border-border hover:border-primary/50 hover:bg-accent/30 flex cursor-pointer items-start gap-4 rounded-xl border-2 p-4 transition-all select-none"
      [class.border-primary]="selected()"
      [class.bg-primary/5]="selected()"
      role="button"
      tabindex="0"
      (click)="toggle()"
      (keydown.enter)="toggle()"
      (keydown.space)="toggle(); $event.preventDefault()"
    >
      <!-- Icon -->
      <div
        class="bg-accent flex h-12 w-12 shrink-0 items-center justify-center rounded-full"
        [class.bg-primary/10]="selected()"
      >
        <nucleo-icon
          [icon]="icon()"
          class="h-6 w-6"
          [class.text-muted-foreground]="!selected()"
          [class.text-primary]="selected()"
        />
      </div>

      <!-- Content -->
      <div class="flex-1 pt-1">
        <div class="font-medium" [class.text-primary]="selected()">
          {{ title() }}
        </div>
        @if (description()) {
          <div class="text-muted-foreground mt-1 text-sm">
            {{ description() }}
          </div>
        }
      </div>

      <!-- Selection Indicator -->
      <div class="pt-1">
        @if (selectionType() === 'single') {
          <!-- Radio-style indicator for single select -->
          <div
            class="border-border flex h-5 w-5 items-center justify-center rounded-full border-2"
            [class.border-primary]="selected()"
            [class.bg-primary]="selected()"
          >
            @if (selected()) {
              <div class="h-2 w-2 rounded-full bg-white"></div>
            }
          </div>
        } @else {
          <!-- Checkbox-style indicator for multi select -->
          <div
            class="border-border flex h-5 w-5 items-center justify-center rounded border-2"
            [class.border-primary]="selected()"
            [class.bg-primary]="selected()"
          >
            @if (selected()) {
              <nucleo-icon [icon]="Check" class="h-3 w-3 text-white" />
            }
          </div>
        }
      </div>
    </div>
  `,
})
export class SelectionCardComponent {
  protected readonly Check = Check;

  readonly title = input.required<string>();
  readonly description = input<string>();
  readonly icon = input.required<NucleoIconData>();
  readonly selected = input.required<boolean>();
  readonly selectionType = input<'single' | 'multi'>('single');

  readonly selectedChange = output<boolean>();

  toggle(): void {
    this.selectedChange.emit(!this.selected());
  }
}
