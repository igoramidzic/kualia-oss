import { ChangeDetectionStrategy, Component } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { nucleoCheck } from '@kualia/icons';
import { classes } from '@spartan-ng/helm/utils';

@Component({
  selector: 'hlm-dropdown-menu-checkbox-indicator',
  imports: [NgIcon],
  providers: [provideIcons({ nucleoCheck })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ` <ng-icon class="text-base" name="nucleoCheck" /> `,
})
export class HlmDropdownMenuCheckboxIndicator {
  constructor() {
    classes(
      () =>
        'pointer-events-none absolute left-2 flex size-3.5 items-center justify-center opacity-0 group-data-[checked]:opacity-100'
    );
  }
}
