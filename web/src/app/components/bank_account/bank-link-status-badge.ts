import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { BrnHoverCard, BrnHoverCardContent, BrnHoverCardTrigger } from '@spartan-ng/brain/hover-card';
import { HlmBadge } from '@spartan-ng/helm/badge';
import { HlmHoverCardContent } from '@spartan-ng/helm/hover-card';
import type { BankAccountWithRelations } from '../../services/bank-account.service';

@Component({
  selector: 'app-bank-link-status-badge',
  imports: [HlmBadge, BrnHoverCard, BrnHoverCardTrigger, BrnHoverCardContent, HlmHoverCardContent],
  template: `
    <brn-hover-card>
      <button brnHoverCardTrigger>
        @if (itemStatus()) {
          <span hlmBadge variant="outline" class="bg-content-background flex h-6 items-center gap-1.5 font-normal">
            <span
              class="h-2 w-2 rounded-full"
              [class.bg-green-500]="itemStatus() === 'Healthy' || itemStatus() === 'active'"
              [class.bg-red-500]="itemStatus() === 'Error'"
              [class.bg-yellow-500]="itemStatus() === 'Pending'"
              [class.bg-gray-500]="itemStatus() === 'Disconnected' || itemStatus() === 'disconnected'"
            ></span>
            {{ formatItemStatus(itemStatus()) }}
          </span>
        }
      </button>
      <hlm-hover-card-content *brnHoverCardContent class="w-80">
        <div class="space-y-2">
          <h4 class="text-sm font-semibold">Bank Link Status</h4>

          @if (connectionData()) {
            <div class="grid gap-1 text-sm">
              <div class="flex justify-between">
                <span class="text-muted-foreground">Connection:</span>
                <span>{{ institutionName() }}</span>
              </div>

              <div class="flex justify-between">
                <span class="text-muted-foreground">Status:</span>
                <span>{{ itemStatus() ?? 'Active' }}</span>
              </div>

              @if (createdAt()) {
                <div class="flex justify-between">
                  <span class="text-muted-foreground">Connected:</span>
                  <span>{{ formatDate(createdAt()!) }}</span>
                </div>
              }
            </div>
          } @else {
            <p class="text-muted-foreground text-sm">No bank link information available</p>
          }
        </div>
      </hlm-hover-card-content>
    </brn-hover-card>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BankLinkStatusBadgeComponent {
  readonly bankAccount = input<BankAccountWithRelations | null>(null);

  readonly bankLinkData = computed(() => this.bankAccount()?.bankLinkAccount?.bankLink ?? null);
  readonly financeKitConnectionData = computed(() => this.bankAccount()?.financeKitAccount?.connection ?? null);
  readonly connectionData = computed(() => this.bankLinkData() ?? this.financeKitConnectionData());

  readonly itemStatus = computed(
    () => this.bankLinkData()?.itemStatus ?? this.financeKitConnectionData()?.status ?? null
  );

  readonly institutionName = computed(
    () =>
      this.bankLinkData()?.institution?.name ?? this.bankAccount()?.financeKitAccount?.institutionName ?? 'Apple Wallet'
  );

  readonly createdAt = computed(() => {
    const account = this.bankAccount();
    // _creationTime is a number (timestamp) from Convex
    if (account && '_creationTime' in account && typeof account._creationTime === 'number') {
      return new Date(account._creationTime).toISOString();
    }
    return account?.createdAt ?? null;
  });

  formatItemStatus(status: string | null): string {
    if (!status) return 'Active';
    if (status === 'active') return 'Connected';
    if (status === 'disconnected') return 'Disconnected';

    return status
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return 'Today';
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return `${diffDays} days ago`;
    } else if (diffDays < 30) {
      const weeks = Math.floor(diffDays / 7);
      return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`;
    } else if (diffDays < 365) {
      const months = Math.floor(diffDays / 30);
      return `${months} ${months === 1 ? 'month' : 'months'} ago`;
    } else {
      const options: Intl.DateTimeFormatOptions = {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      };
      return date.toLocaleDateString('en-US', options);
    }
  }
}
