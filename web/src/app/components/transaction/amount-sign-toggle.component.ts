import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { nucleoArrowDownLeft as ArrowDownLeft, nucleoArrowUpRight as ArrowUpRight, NucleoIcon } from '@kualia/icons';
import { HlmToggleGroupImports } from '../../ui/toggle-group/src';

export type AmountSign = 'inflow' | 'outflow';

@Component({
  selector: 'app-amount-sign-toggle',
  imports: [NucleoIcon, ...HlmToggleGroupImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      hlmToggleGroup
      class="mb-4"
      variant="outline"
      [spacing]="spacing()"
      [value]="value()"
      [disabled]="disabled()"
      (valueChange)="onValueChange($event)"
    >
      <button
        hlmToggleGroupItem
        value="outflow"
        size="sm"
        class="group text-muted-foreground data-[state=on]:border-destructive/20 data-[state=on]:bg-destructive/5 w-32"
      >
        <nucleo-icon [icon]="ArrowDownLeft" [size]="16" />
        Outflow
      </button>
      <button
        hlmToggleGroupItem
        value="inflow"
        size="sm"
        class="group text-muted-foreground w-32 data-[state=on]:border-green-500/20 data-[state=on]:bg-green-500/5"
      >
        <nucleo-icon [icon]="ArrowUpRight" [size]="16" />
        Inflow
      </button>
    </div>
  `,
})
export class AmountSignToggleComponent {
  readonly value = input<AmountSign>('outflow');
  readonly disabled = input<boolean>(false);
  readonly size = input<'default' | 'sm' | 'lg'>('default');
  readonly spacing = input<number>(0);

  readonly valueChange = output<AmountSign>();

  protected readonly ArrowDownLeft = ArrowDownLeft;
  protected readonly ArrowUpRight = ArrowUpRight;

  onValueChange(value: string | string[] | null | undefined) {
    const sign = value as AmountSign | null | undefined;
    if (sign) {
      this.valueChange.emit(sign);
    }
  }
}
