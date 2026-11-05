import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { HlmBadge } from '@spartan-ng/helm/badge';
import type { BankAccountWithRelations } from '../../services/bank-account.service';

@Component({
  selector: 'app-closed-account-badge',
  imports: [HlmBadge],
  template: `
    @if (bankAccount()?.isClosed) {
      <span
        hlmBadge
        variant="outline"
        class="bg-content-background flex h-6 items-center gap-1.5 font-normal select-none"
      >
        Closed
      </span>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClosedAccountBadgeComponent {
  readonly bankAccount = input<BankAccountWithRelations | null>(null);
}
