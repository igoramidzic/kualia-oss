import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { nucleoCheck } from '@kualia/icons';
import { BrnComboboxItem } from '@spartan-ng/brain/combobox';
import { classes } from '@spartan-ng/helm/utils';

@Component({
  selector: 'hlm-combobox-item',
  imports: [NgIcon],
  providers: [provideIcons({ nucleoCheck })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  hostDirectives: [{ directive: BrnComboboxItem, inputs: ['id', 'disabled', 'value'] }],
  host: { 'data-slot': 'combobox-item' },
  template: `
    <ng-content />
    @if (_active()) {
      <ng-icon
        name="nucleoCheck"
        class="absolute start-2 flex items-center justify-center text-[calc(var(--spacing)*4)]"
        aria-hidden="true"
      />
    }
  `,
})
export class HlmComboboxItem {
  private readonly _brnComboboxItem = inject(BrnComboboxItem);

  protected readonly _active = this._brnComboboxItem.active;

  constructor() {
    classes(
      () =>
        'data-highlighted:bg-accent data-highlighted:text-accent-foreground not-data-[variant=destructive]:data-highlighted:**:text-accent-foreground gap-2 rounded-sm py-1.5 ps-8 pe-2 text-sm relative flex w-full cursor-default items-center outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-hidden:hidden [&_ng-icon]:pointer-events-none [&_ng-icon]:shrink-0'
    );
  }
}
