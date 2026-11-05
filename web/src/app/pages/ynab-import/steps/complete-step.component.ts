import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { nucleoCheckCircle as CheckCircle2, NucleoIcon, nucleoParty as PartyPopper } from '@kualia/icons';
import type { ImportStatus } from '../../../services/ynab-import.service';

@Component({
  selector: 'app-complete-step',
  imports: [NucleoIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col items-center gap-8 py-8">
      <!-- Success Icon -->
      <div class="bg-success/10 flex h-24 w-24 items-center justify-center rounded-full">
        <nucleo-icon [icon]="PartyPopper" class="text-success h-12 w-12" />
      </div>

      <!-- Success Message -->
      <div class="text-center">
        <h2 class="text-2xl font-semibold">Welcome to Kualia!</h2>
        <p class="text-muted-foreground mt-2">Your YNAB data has been imported successfully.</p>
      </div>

      <!-- Summary -->
      <div class="bg-muted/50 w-full max-w-sm rounded-lg p-6">
        <h3 class="mb-4 font-medium">What's next?</h3>
        <ul class="space-y-3">
          <li class="flex items-start gap-3">
            <nucleo-icon [icon]="CheckCircle2" class="text-success mt-0.5 h-5 w-5 shrink-0" />
            <span class="text-sm">Your accounts and balances are ready</span>
          </li>
          <li class="flex items-start gap-3">
            <nucleo-icon [icon]="CheckCircle2" class="text-success mt-0.5 h-5 w-5 shrink-0" />
            <span class="text-sm">Categories and budget assignments imported</span>
          </li>
          <li class="flex items-start gap-3">
            <nucleo-icon [icon]="CheckCircle2" class="text-success mt-0.5 h-5 w-5 shrink-0" />
            <span class="text-sm">All transactions are in place</span>
          </li>
        </ul>
      </div>

      <!-- YNAB vs Kualia differences -->
      <div class="bg-muted/50 w-full max-w-sm rounded-lg border p-6">
        <h3 class="mb-3 font-medium">Why your numbers might look different</h3>
        <p class="text-muted-foreground text-sm leading-relaxed">
          YNAB resets negative category balances to zero each month. Kualia carries over negative balances, so you'll
          see overspending reflected in future months. This gives you a more accurate picture of your actual budget
          situation.
        </p>
        <p class="text-muted-foreground mt-4 text-sm">
          If something doesn't look right, reach out to us at
          <a href="mailto:support@kualia.com" class="text-primary hover:underline">support&#64;kualia.com</a>
          and we'll help you get it sorted out.
        </p>
      </div>

      <p class="text-muted-foreground text-center text-sm">
        Click the button below to go to your new workspace and start budgeting!
      </p>
    </div>
  `,
})
export class CompleteStepComponent {
  protected readonly PartyPopper = PartyPopper;
  protected readonly CheckCircle2 = CheckCircle2;

  readonly importStatus = input<ImportStatus | null>(null);
}
