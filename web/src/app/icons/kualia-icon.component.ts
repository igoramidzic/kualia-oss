import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import type { KualiaIconData } from './kualia-icons';

@Component({
  selector: 'kualia-icon',
  imports: [NgIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'aria-hidden': 'true',
    '[style.--kualia-icon-size]': 'cssSize()',
  },
  template: '<ng-icon [svg]="icon()" size="100%" />',
  styles: `
    @layer base {
      :host {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        width: var(--kualia-icon-size);
        height: var(--kualia-icon-size);
        vertical-align: middle;
      }
    }
  `,
})
export class KualiaIcon {
  readonly icon = input.required<KualiaIconData>();
  readonly size = input<number | string>(24);

  protected cssSize(): string {
    const size = this.size();
    return typeof size === 'number' || /^\d+(\.\d+)?$/.test(size) ? `${size}px` : size;
  }
}
