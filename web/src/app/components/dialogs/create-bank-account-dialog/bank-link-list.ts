import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { HlmButton } from '@spartan-ng/helm/button';
import type { Id } from 'convex/_generated/dataModel';
import {
  nucleoBank as Building2,
  nucleoChevronRight as ChevronRight,
  NucleoIcon,
  nucleoPlus as Plus,
} from '@kualia/icons';
import type { BankLinkAccountGroup, BankLinkAccountGroupAccount } from '../../../services/bank-connection.service';
import { isSupportedForLinking } from '../../../shared/utils/account-type-utils';

// Re-export for use by other components
export type BankLinkGroup = BankLinkAccountGroup;
export type BankLinkAccount = BankLinkAccountGroupAccount;

@Component({
  selector: 'app-bank-link-list',
  imports: [NucleoIcon, HlmButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="p-3">
      @if (loading()) {
        <div class="space-y-3">
          @for (i of [1, 2]; track i) {
            <div class="bg-muted h-20 animate-pulse rounded-lg"></div>
          }
        </div>
      } @else if (bankLinks().length === 0) {
        <div class="py-8 text-center">
          <div class="bg-muted mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full">
            <nucleo-icon [icon]="Building2" class="text-muted-foreground h-8 w-8" />
          </div>
          <p class="text-muted-foreground text-sm">No bank connections yet</p>
          <p class="text-muted-foreground mt-1 text-xs">Connect your bank to import accounts automatically</p>
        </div>
      } @else {
        <div class="space-y-2">
          @for (bankLink of bankLinks(); track bankLink.bankLinkId) {
            @let linkableCount = getLinkableCount(bankLink);
            <button
              hlmBtn
              variant="secondary"
              class="h-auto w-full justify-start overflow-hidden p-4"
              [disabled]="linkableCount === 0"
              (click)="bankLinkSelected.emit(bankLink.bankLinkId)"
            >
              <div class="flex w-full items-center gap-3">
                @if (bankLink.institution?.logo) {
                  <img
                    [src]="bankLink.institution?.logo"
                    [alt]="bankLink.institution?.name"
                    class="h-10 w-10 rounded-full object-contain"
                  />
                } @else {
                  <div class="bg-muted flex h-10 w-10 items-center justify-center rounded-full">
                    <nucleo-icon [icon]="Building2" class="text-muted-foreground h-5 w-5" />
                  </div>
                }
                <div class="min-w-0 flex-1 text-left">
                  <div class="font-medium">{{ bankLink.institution?.name ?? 'Unknown Bank' }}</div>
                  <div class="text-muted-foreground text-sm">
                    @if (linkableCount > 0) {
                      {{ linkableCount }} account{{ linkableCount > 1 ? 's' : '' }} available
                    } @else {
                      All accounts linked
                    }
                  </div>
                </div>
                @if (linkableCount > 0) {
                  <nucleo-icon [icon]="ChevronRight" class="text-muted-foreground h-5 w-5" />
                }
              </div>
            </button>
          }
        </div>
      }

      <!-- Connect New Bank button -->
      <div class="mt-4 border-t pt-4">
        <button
          hlmBtn
          variant="secondary"
          class="h-auto w-full justify-start overflow-hidden border-dashed p-4"
          (click)="connectNewClicked.emit()"
        >
          <div class="flex w-full items-center gap-3">
            <div class="bg-primary/10 flex h-10 w-10 items-center justify-center rounded-full">
              <nucleo-icon [icon]="Plus" class="text-primary h-5 w-5" />
            </div>
            <div class="min-w-0 flex-1 text-left">
              <div class="font-medium">Connect New Bank</div>
              <div class="text-muted-foreground text-sm font-light">Link a new bank via Plaid</div>
            </div>
            <nucleo-icon [icon]="ChevronRight" class="text-muted-foreground h-5 w-5" />
          </div>
        </button>
      </div>
    </div>
  `,
})
export class BankLinkListComponent {
  protected readonly Building2 = Building2;
  protected readonly ChevronRight = ChevronRight;
  protected readonly Plus = Plus;

  readonly bankLinks = input.required<BankLinkGroup[]>();
  readonly loading = input<boolean>(false);

  readonly bankLinkSelected = output<Id<'bankLink'>>();
  readonly connectNewClicked = output<void>();

  readonly hasAvailableAccounts = computed(() => this.bankLinks().some((bl) => this.getLinkableCount(bl) > 0));

  /**
   * Gets the count of accounts that can be linked (not already linked AND supported type)
   */
  getLinkableCount(bankLink: BankLinkGroup): number {
    return bankLink.accounts.filter((a) => !a.isLinked && isSupportedForLinking(a.accountType)).length;
  }

  /**
   * @deprecated Use getLinkableCount instead
   */
  getUnlinkedCount(bankLink: BankLinkGroup): number {
    return this.getLinkableCount(bankLink);
  }
}
