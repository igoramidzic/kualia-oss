import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogFooter } from '@spartan-ng/helm/dialog';
import { nucleoLoader as LoaderCircle, NucleoIcon } from '@kualia/icons';
import { CurrencyPipe } from '../../../shared/pipes/currency.pipe';
import { formatAccountType } from '../../../shared/utils/account-type-utils';
import type { BankLinkAccount, BankLinkGroup } from './bank-link-list';

@Component({
  selector: 'app-account-confirmation',
  imports: [HlmButton, HlmDialogFooter, NucleoIcon, CurrencyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="p-3">
      <div class="mb-4">
        <p class="text-muted-foreground text-sm">
          The following {{ selectedAccounts().length }} account{{ selectedAccounts().length > 1 ? 's' : '' }} will be
          created in Kualia and linked to your bank for automatic transaction import.
        </p>
      </div>

      <div class="space-y-3">
        @for (account of selectedAccounts(); track account._id) {
          <div class="border-border rounded-lg border p-4">
            <div class="font-medium">{{ account.name }}</div>
            <div class="text-muted-foreground flex items-center gap-2 text-sm">
              <span>{{ formatAccountType(account.accountType) }}</span>
              @if (account.accountNumberMask) {
                <span>•</span>
                <span>{{ account.accountNumberMask }}</span>
              }
            </div>
            @if (account.initialBalance !== null) {
              <div class="text-muted-foreground mt-1 text-sm">
                Starting balance: {{ account.initialBalance | currency }}
              </div>
            }
          </div>
        }
      </div>

      @if (error()) {
        <div class="border-destructive bg-destructive/10 text-destructive mt-4 rounded-lg border p-3 text-sm">
          {{ error() }}
        </div>
      }
    </div>

    <hlm-dialog-footer class="flex-row justify-end gap-2">
      <button hlmBtn (click)="confirmClicked.emit()" [disabled]="isProcessing()">
        @if (isProcessing()) {
          <nucleo-icon [icon]="LoaderCircle" class="h-4 w-4 animate-spin" />
          Creating...
        } @else {
          Create {{ selectedAccounts().length }} Account{{ selectedAccounts().length > 1 ? 's' : '' }}
        }
      </button>
    </hlm-dialog-footer>
  `,
})
export class AccountConfirmationComponent {
  protected readonly LoaderCircle = LoaderCircle;
  protected readonly formatAccountType = formatAccountType;

  readonly bankLink = input.required<BankLinkGroup>();
  readonly selectedAccounts = input.required<BankLinkAccount[]>();
  readonly isProcessing = input<boolean>(false);
  readonly error = input<string | null>(null);

  readonly confirmClicked = output<void>();
}
