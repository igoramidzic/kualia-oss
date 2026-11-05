import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import type { NucleoIconData } from './nucleo-icons';

@Component({
  selector: 'nucleo-icon',
  imports: [NgIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'aria-hidden': 'true',
    '[style.--nucleo-icon-size]': 'cssSize()',
  },
  template: '<ng-icon [svg]="icon()" size="100%" />',
  styles: `
    @layer base {
      :host {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        width: var(--nucleo-icon-size);
        height: var(--nucleo-icon-size);
        vertical-align: middle;
      }
    }
  `,
})
export class NucleoIcon {
  readonly icon = input.required<NucleoIconData>();
  readonly size = input<number | string>(24);

  protected cssSize(): string {
    const size = this.size();
    return typeof size === 'number' || /^\d+(\.\d+)?$/.test(size) ? `${size}px` : size;
  }
}
