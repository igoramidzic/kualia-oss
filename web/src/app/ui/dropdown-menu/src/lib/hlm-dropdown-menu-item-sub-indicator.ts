import { ChangeDetectionStrategy, Component } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { nucleoChevronRight } from '@kualia/icons';
import { classes } from '@spartan-ng/helm/utils';

@Component({
  selector: 'hlm-dropdown-menu-item-sub-indicator',
  imports: [NgIcon],
  providers: [provideIcons({ nucleoChevronRight })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ` <ng-icon name="nucleoChevronRight" class="text-base" /> `,
})
export class HlmDropdownMenuItemSubIndicator {
  constructor() {
    classes(() => 'ms-auto size-4');
  }
}
