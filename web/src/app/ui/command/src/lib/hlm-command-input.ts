import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { BrnCommandInput } from '@spartan-ng/brain/command';
import { HlmInputGroupImports } from '@spartan-ng/helm/input-group';
import { hlm } from '@spartan-ng/helm/utils';
import type { ClassValue } from 'clsx';

@Component({
  selector: 'hlm-command-input',
  imports: [HlmInputGroupImports, BrnCommandInput],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-input-group [class]="_inputGroupClass()">
      <input
        brnCommandInput
        data-slot="command-input"
        class="w-full text-sm outline-hidden disabled:cursor-not-allowed disabled:opacity-50"
        [id]="inputId()"
        [placeholder]="placeholder()"
      />
    </hlm-input-group>
  `,
})
export class HlmCommandInput {
  public readonly userClass = input<ClassValue>('', { alias: 'class' });
  public readonly inputId = input<string | undefined>();
  public readonly placeholder = input<string>('');

  protected readonly _inputGroupClass = computed(() =>
    hlm(
      'border-border h-8 rounded-none border-t-0 border-r-0 border-b-1 border-l-0 px-2 shadow-none *:data-[slot=input-group-addon]:pl-2',
      this.userClass()
    )
  );
}
