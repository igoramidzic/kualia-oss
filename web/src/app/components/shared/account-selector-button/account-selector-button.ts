import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { HlmButton } from '@spartan-ng/helm/button';
import type { Id } from 'convex/_generated/dataModel';
import { nucleoCheck as Check, NucleoIcon } from '@kualia/icons';
import { CurrencyService } from '../../../services/currency.service';
import { formatAccountType } from '../../../shared/utils/account-type-utils';

export interface BankAccountForSelection {
  _id: Id<'bankAccount'>;
  name: string;
  accountType: string;
  currentBalance: bigint;
  bankLinkAccountId?: Id<'bankLinkAccount'>;
}

@Component({
  selector: 'app-account-selector-button',
  imports: [HlmButton, NucleoIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      hlmBtn
      variant="outline"
      class="h-auto w-full justify-start p-4 text-left"
      [disabled]="disabled()"
      (click)="!disabled() && selected.emit()"
    >
      <div class="flex w-full items-center justify-between">
        <div class="flex-1">
          <div class="flex items-center gap-2">
            <p class="font-medium">{{ account().name }}</p>
            @if (isSelected()) {
              <nucleo-icon [icon]="Check" [size]="16" class="text-primary" />
            }
          </div>
          <p class="text-muted-foreground text-xs">
            {{ formatAccountType(account().accountType) }}
            @if (formattedBalance()) {
              · {{ formattedBalance() }}
            }
          </p>
          @if (disabled() && disabledReason()) {
            <p class="text-destructive mt-1 text-xs">{{ disabledReason() }}</p>
          }
        </div>
      </div>
    </button>
  `,
})
export class AccountSelectorButtonComponent {
  private readonly currencyService = inject(CurrencyService);

  // Inputs
  readonly account = input.required<BankAccountForSelection>();
  readonly disabled = input<boolean>(false);
  readonly disabledReason = input<string>();
  readonly isSelected = input<boolean>(false);

  // Outputs
  readonly selected = output<void>();

  // Helpers
  protected readonly formatAccountType = formatAccountType;
  protected readonly Check = Check;

  protected readonly formattedBalance = (): string => {
    const balance = this.account().currentBalance;
    return this.currencyService.format(balance);
  };
}
