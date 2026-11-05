import type { BooleanInput } from '@angular/cdk/coercion';
import { booleanAttribute, ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { nucleoChevronDown } from '@kualia/icons';
import { BrnComboboxAnchor, BrnComboboxPopoverTrigger, BrnComboboxTrigger } from '@spartan-ng/brain/combobox';
import { BrnFieldControlDescribedBy } from '@spartan-ng/brain/field';
import { ButtonVariants, HlmButton } from '@spartan-ng/helm/button';
import { hlm } from '@spartan-ng/helm/utils';
import type { ClassValue } from 'clsx';

@Component({
  selector: 'hlm-combobox-trigger',
  imports: [
    NgIcon,
    HlmButton,
    BrnComboboxAnchor,
    BrnComboboxTrigger,
    BrnComboboxPopoverTrigger,
    BrnFieldControlDescribedBy,
  ],
  providers: [provideIcons({ nucleoChevronDown })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      brnComboboxTrigger
      brnComboboxAnchor
      brnComboboxPopoverTrigger
      brnFieldControlDescribedBy
      hlmBtn
      data-slot="combobox-trigger"
      [id]="buttonId()"
      [class]="_computedClass()"
      [variant]="variant()"
      (click)="onClick($event)"
    >
      <ng-content />
      @if (showIcon()) {
        <ng-icon name="nucleoChevronDown" class="text-muted-foreground text-[calc(var(--spacing)*4)]" />
      }
    </button>
  `,
})
export class HlmComboboxTrigger {
  private static _id = 0;

  public readonly userClass = input<ClassValue>('', {
    alias: 'class',
  });
  protected readonly _computedClass = computed(() =>
    hlm(
      'data-placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
      this.userClass()
    )
  );

  public readonly buttonId = input<string>(`hlm-combobox-trigger-${HlmComboboxTrigger._id++}`);

  public readonly variant = input<ButtonVariants['variant']>('outline');

  public readonly showIcon = input<boolean, BooleanInput>(true, { transform: booleanAttribute });

  public readonly stopPropagation = input<boolean, BooleanInput>(false, { transform: booleanAttribute });

  onClick(event: Event): void {
    if (!this.stopPropagation()) return;

    event.stopPropagation();
    event.preventDefault();
  }
}
