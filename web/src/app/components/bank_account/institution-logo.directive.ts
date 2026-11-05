import { Directive, computed, input } from '@angular/core';
import { hlm } from '@spartan-ng/helm/utils';
import type { ClassValue } from 'clsx';

@Directive({
  selector: 'img[appInstitutionLogo]',
  host: {
    '[class]': '_computedClass()',
    '[src]': 'src()',
    '[alt]': 'alt()',
  },
})
export class InstitutionLogoDirective {
  public readonly src = input.required<string | null>();
  public readonly alt = input<string>('Institution');
  public readonly userClass = input<ClassValue>('');

  protected _computedClass = computed(() => hlm('bg-accent h-6 w-6 rounded-full', this.userClass()));
}
