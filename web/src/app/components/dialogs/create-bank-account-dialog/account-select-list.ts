import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCheckbox } from '@spartan-ng/helm/checkbox';
import { HlmDialogFooter } from '@spartan-ng/helm/dialog';
import type { Id } from 'convex/_generated/dataModel';
import {
  nucleoBank as Building2,
  nucleoCheck as Check,
  NucleoIcon,
  nucleoMinusCircle as MinusCircle,
} from '@kualia/icons';
import { formatAccountType, isSupportedForLinking } from '../../../shared/utils/account-type-utils';
import type { BankLinkGroup } from './bank-link-list';

@Component({
  selector: 'app-account-select-list',
  imports: [HlmButton, HlmCheckbox, HlmDialogFooter, NucleoIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="p-3 select-none">
      <!-- Institution Header -->
      <div class="mb-4 flex items-center gap-3">
        @if (bankLink().institution?.logo) {
          <img
            [src]="bankLink().institution!.logo"
            [alt]="bankLink().institution!.name"
            class="h-10 w-10 rounded-full object-contain"
          />
        } @else {
          <div class="bg-muted flex h-10 w-10 items-center justify-center rounded-full">
            <nucleo-icon [icon]="Building2" class="text-muted-foreground h-5 w-5" />
          </div>
        }
        <div>
          <h3 class="font-medium">{{ bankLink().institution?.name ?? 'Unknown Bank' }}</h3>
          <p class="text-muted-foreground text-sm">Select accounts to add to Kualia</p>
        </div>
      </div>

      <!-- Select All -->
      @if (unlinkedAccounts().length > 1) {
        <div class="border-border mb-3 flex items-center gap-3 border-b pb-3 select-none">
          <hlm-checkbox
            id="select-all"
            [checked]="allSelected()"
            [indeterminate]="isIndeterminate()"
            (checkedChange)="onSelectAllChange()"
          />
          <label for="select-all" class="cursor-pointer text-sm font-medium">
            Select All ({{ unlinkedAccounts().length }})
          </label>
        </div>
      }

      <!-- Unlinked Accounts -->
      @if (unlinkedAccounts().length > 0) {
        <div class="space-y-2 select-none">
          @for (account of unlinkedAccounts(); track account._id) {
            <div
              class="border-border hover:bg-accent/50 flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors"
              role="button"
              tabindex="0"
              (click)="accountToggled.emit(account._id)"
              (keydown.enter)="accountToggled.emit(account._id)"
              (keydown.space)="accountToggled.emit(account._id); $event.preventDefault()"
            >
              <hlm-checkbox
                [checked]="selectedAccountIds().has(account._id)"
                (checkedChange)="accountToggled.emit(account._id)"
              />
              <div class="flex-1">
                <div class="font-medium">{{ account.name }}</div>
                <div class="text-muted-foreground flex items-center gap-2 text-sm">
                  <span>{{ formatAccountType(account.accountType) }}</span>
                  @if (account.accountNumberMask) {
                    <span>•</span>
                    <span>{{ account.accountNumberMask }}</span>
                  }
                </div>
              </div>
            </div>
          }
        </div>
      } @else {
        @if (linkedAccounts().length > 0) {
          <div class="text-muted-foreground py-8 text-center text-sm">
            All supported accounts from this bank are already linked
          </div>
        } @else if (unsupportedAccounts().length > 0) {
          <div class="text-muted-foreground py-8 text-center text-sm">
            No supported accounts available. This connection only has investment or loan accounts, which aren't
            supported yet.
          </div>
        } @else {
          <div class="text-muted-foreground py-8 text-center text-sm">No accounts found for this bank</div>
        }
      }

      <!-- Already Linked Section -->
      @if (linkedAccounts().length > 0) {
        <div class="mt-4 border-t pt-4">
          <h4 class="text-muted-foreground mb-2 text-xs font-medium uppercase">Already Linked</h4>
          <div class="space-y-2">
            @for (account of linkedAccounts(); track account._id) {
              <div class="border-border flex items-center gap-3 rounded-lg border p-3 opacity-50">
                <nucleo-icon [icon]="Check" class="text-primary h-4 w-4" />
                <div class="flex-1">
                  <div class="font-medium">{{ account.name }}</div>
                  <div class="text-muted-foreground text-sm">Linked to {{ account.linkedToBankAccount?.name }}</div>
                </div>
              </div>
            }
          </div>
        </div>
      }

      <!-- Not Yet Supported Section -->
      @if (unsupportedAccounts().length > 0) {
        <div class="mt-4 border-t pt-4">
          <h4 class="text-muted-foreground mb-2 text-xs font-medium uppercase">Not Yet Supported</h4>
          <div class="space-y-2">
            @for (account of unsupportedAccounts(); track account._id) {
              <div class="border-border flex items-center gap-3 rounded-lg border p-3 opacity-50">
                <nucleo-icon [icon]="MinusCircle" class="text-muted-foreground h-4 w-4" />
                <div class="flex-1">
                  <div class="text-muted-foreground font-medium">{{ account.name }}</div>
                  <div class="text-muted-foreground flex items-center gap-2 text-sm">
                    <span>{{ formatAccountType(account.accountType) }}</span>
                    @if (account.accountNumberMask) {
                      <span>•</span>
                      <span>{{ account.accountNumberMask }}</span>
                    }
                    <span>•</span>
                    <span>Coming soon</span>
                  </div>
                </div>
              </div>
            }
          </div>
        </div>
      }
    </div>

    <hlm-dialog-footer class="flex-row justify-end gap-2">
      <button hlmBtn variant="default" [disabled]="selectedAccountIds().size === 0" (click)="continueClicked.emit()">
        Continue ({{ selectedAccountIds().size }})
      </button>
    </hlm-dialog-footer>
  `,
})
export class AccountSelectListComponent {
  protected readonly Building2 = Building2;
  protected readonly Check = Check;
  protected readonly MinusCircle = MinusCircle;
  protected readonly formatAccountType = formatAccountType;

  readonly bankLink = input.required<BankLinkGroup>();
  readonly selectedAccountIds = input.required<Set<Id<'bankLinkAccount'>>>();

  readonly accountToggled = output<Id<'bankLinkAccount'>>();
  readonly selectAllToggled = output<boolean>();
  readonly continueClicked = output<void>();

  // Accounts that are unlinked AND supported for linking (banking/credit)
  readonly unlinkedAccounts = computed(() =>
    this.bankLink().accounts.filter((a) => !a.isLinked && isSupportedForLinking(a.accountType))
  );

  readonly linkedAccounts = computed(() => this.bankLink().accounts.filter((a) => a.isLinked));

  // Accounts that are unlinked but NOT supported for linking (investment/loan)
  readonly unsupportedAccounts = computed(() =>
    this.bankLink().accounts.filter((a) => !a.isLinked && !isSupportedForLinking(a.accountType))
  );

  readonly allSelected = computed(() => {
    const unlinked = this.unlinkedAccounts();
    if (unlinked.length === 0) return false;
    return unlinked.every((a) => this.selectedAccountIds().has(a._id));
  });

  readonly someSelected = computed(() => this.unlinkedAccounts().some((a) => this.selectedAccountIds().has(a._id)));

  readonly isIndeterminate = computed(() => this.someSelected() && !this.allSelected());

  onSelectAllChange(): void {
    this.selectAllToggled.emit(!this.allSelected());
  }
}
