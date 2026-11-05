import { computed, Directive, input } from '@angular/core';
import { hlm } from '@spartan-ng/helm/utils';
import type { ClassValue } from 'clsx';

@Directive({
  selector: 'hlm-error',
  host: {
    '[class]': '_computedClass()',
  },
})
export class HlmError {
  public readonly userClass = input<ClassValue>('', { alias: 'class' });
  protected readonly _computedClass = computed(() =>
    hlm('text-destructive block text-sm font-medium', this.userClass())
  );
}
