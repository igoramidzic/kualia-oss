import { ChangeDetectionStrategy, Component } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { nucleoChevronRight } from '@kualia/icons';
import { classes } from '@spartan-ng/helm/utils';

@Component({
  selector: '[hlmBreadcrumbSeparator]',
  imports: [NgIcon],
  providers: [provideIcons({ nucleoChevronRight })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'data-slot': 'breadcrumb-separator',
    role: 'presentation',
    'aria-hidden': 'true',
  },
  template: `
    <ng-content>
      <ng-icon name="nucleoChevronRight" />
    </ng-content>
  `,
})
export class HlmBreadcrumbSeparator {
  constructor() {
    classes(() => '[&>ng-icon]:text-[calc(var(--spacing)*3.5)] [&>ng-icon]:flex');
  }
}
