import { ChangeDetectionStrategy, Component } from '@angular/core';
import { nucleoCheckCircle as CheckCircle, NucleoIcon } from '@kualia/icons';

@Component({
  selector: 'app-complete-step',
  imports: [NucleoIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col items-center py-8 text-center">
      <div class="bg-primary/10 mb-6 flex h-20 w-20 items-center justify-center rounded-full">
        <nucleo-icon [icon]="CheckCircle" class="text-primary h-10 w-10" />
      </div>

      <p class="text-muted-foreground max-w-sm">
        We've created a personalized budget for you based on your answers. You're ready to start taking control of your
        finances!
      </p>
    </div>
  `,
})
export class CompleteStepComponent {
  protected readonly CheckCircle = CheckCircle;
}
