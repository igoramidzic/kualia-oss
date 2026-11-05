import { ChangeDetectionStrategy, Component, computed, input, OnDestroy, signal } from '@angular/core';
import { HlmBadge } from '@spartan-ng/helm/badge';
import { nucleoFile as FileText, NucleoIcon, nucleoRefresh as RefreshCw } from '@kualia/icons';
import type { BankAccountWithRelations } from '../../services/bank-account.service';

@Component({
  selector: 'app-last-synced-badge',
  imports: [HlmBadge, NucleoIcon],
  template: `
    @if (connectionData()) {
      <span
        hlmBadge
        variant="outline"
        class="bg-content-background flex h-6 items-center gap-1.5 font-normal select-none"
      >
        <nucleo-icon [icon]="RefreshCw" class="h-3 w-3" [class.animate-spin]="isInitialSync()" />
        {{ lastSyncedText() }}
      </span>
    } @else {
      <span
        hlmBadge
        variant="outline"
        class="bg-content-background flex h-6 items-center gap-1.5 font-normal select-none"
      >
        <nucleo-icon [icon]="FileText" class="h-3 w-3" />
        Manual entry
      </span>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LastSyncedBadgeComponent implements OnDestroy {
  readonly RefreshCw = RefreshCw;
  readonly FileText = FileText;

  readonly bankAccount = input<BankAccountWithRelations | null>(null);

  readonly bankLinkData = computed(() => this.bankAccount()?.bankLinkAccount?.bankLink ?? null);
  readonly financeKitConnectionData = computed(() => this.bankAccount()?.financeKitAccount?.connection ?? null);
  readonly connectionData = computed(() => this.bankLinkData() ?? this.financeKitConnectionData());

  // Signal to track current time, updates every minute
  private readonly currentTime = signal(new Date());
  private intervalId?: number;

  constructor() {
    // Update current time every minute
    this.intervalId = window.setInterval(() => {
      this.currentTime.set(new Date());
    }, 60000); // Update every 60 seconds
  }

  ngOnDestroy() {
    if (this.intervalId) {
      window.clearInterval(this.intervalId);
    }
  }

  readonly isInitialSync = computed(() => {
    const connection = this.connectionData();
    return connection && !connection.lastSyncedAt;
  });

  readonly lastSyncedText = computed(() => {
    const connection = this.connectionData();
    if (!connection?.lastSyncedAt) return 'Syncing...';

    const date = new Date(connection.lastSyncedAt);
    const now = this.currentTime(); // Use the reactive signal
    const diffMs = now.getTime() - date.getTime();
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMinutes < 1) {
      return 'Just now';
    } else if (diffMinutes < 60) {
      return `${diffMinutes} ${diffMinutes === 1 ? 'min' : 'mins'} ago`;
    } else if (diffHours < 24) {
      return `${diffHours} ${diffHours === 1 ? 'hour' : 'hours'} ago`;
    } else if (diffDays < 7) {
      return `${diffDays} ${diffDays === 1 ? 'day' : 'days'} ago`;
    } else if (diffDays < 30) {
      const weeks = Math.floor(diffDays / 7);
      return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`;
    } else if (diffDays < 365) {
      const months = Math.floor(diffDays / 30);
      return `${months} ${months === 1 ? 'month' : 'months'} ago`;
    } else {
      const years = Math.floor(diffDays / 365);
      return `${years} ${years === 1 ? 'year' : 'years'} ago`;
    }
  });
}
