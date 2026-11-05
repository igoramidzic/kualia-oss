import { Directive } from '@angular/core';
import { classes } from '@spartan-ng/helm/utils';

@Directive({
  selector: '[hlmDialogFooter],hlm-dialog-footer',
  host: {
    'data-slot': 'dialog-footer',
  },
})
export class HlmDialogFooter {
  constructor() {
    classes(() => 'flex flex-col-reverse p-3 gap-2 sm:flex-row sm:justify-end');
  }
}
