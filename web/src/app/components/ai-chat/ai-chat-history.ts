import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { BrnComboboxImports } from '@spartan-ng/brain/combobox';
import { BrnPopoverContent } from '@spartan-ng/brain/popover';
import { HlmComboboxImports } from '@spartan-ng/helm/combobox';
import { nucleoHistory as History, NucleoIcon } from '@kualia/icons';
import { AiChatService, ThreadSummary } from '../../services/ai-chat.service';
import { HlmTooltip } from '../../ui/tooltip/src';
import { bucketLabel, formatRelativeShort, HISTORY_BUCKET_ORDER, HistoryBucket } from './history-buckets';

export interface HistorySelectEvent {
  threadId: string;
  title: string | null;
}

interface HistoryGroup {
  label: string;
  threads: ThreadSummary[];
}

@Component({
  selector: 'app-ai-chat-history',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NucleoIcon, HlmTooltip, BrnComboboxImports, BrnPopoverContent, HlmComboboxImports],
  templateUrl: './ai-chat-history.html',
})
export class AiChatHistoryComponent {
  protected readonly aiChat = inject(AiChatService);
  protected readonly History = History;

  /** Threads to show in the popover. The parent passes archived chats (newest first). */
  readonly threads = input<ThreadSummary[]>([]);

  readonly threadSelect = output<HistorySelectEvent>();

  /** Disable the combobox's built-in filtering — we group + filter manually. */
  protected readonly noopFilter = (): boolean => true;

  protected readonly search = signal<string>('');

  /** Re-evaluated on every render so "5 minutes ago" stays roughly fresh while open. */
  private readonly nowTick = signal<number>(Date.now());

  /**
   * Threads filtered by the search term and bucketed by date. Buckets render in fixed order so
   * the visual hierarchy is stable; empty buckets are skipped.
   */
  protected readonly groupedThreads = computed<HistoryGroup[]>(() => {
    const term = this.search().trim().toLowerCase();
    const filtered = term
      ? this.threads().filter((t) => (t.title ?? 'new chat').toLowerCase().includes(term))
      : this.threads();
    if (filtered.length === 0) return [];

    const now = new Date(this.nowTick());
    const buckets = new Map<HistoryBucket, ThreadSummary[]>();
    for (const thread of filtered) {
      const label = bucketLabel(thread.lastUpdatedAt, now);
      const arr = buckets.get(label) ?? [];
      arr.push(thread);
      buckets.set(label, arr);
    }
    const result: HistoryGroup[] = [];
    for (const label of HISTORY_BUCKET_ORDER) {
      const threads = buckets.get(label);
      if (threads && threads.length > 0) result.push({ label, threads });
    }
    return result;
  });

  protected onSearchChange(value: string): void {
    this.search.set(value);
  }

  protected onValueChange(value: string | null | undefined): void {
    if (!value) return;
    const thread = this.threads().find((t) => t.threadId === value);
    if (!thread) return;
    this.threadSelect.emit({ threadId: thread.threadId, title: thread.title ?? null });
    this.search.set('');
  }

  /** Compact relative time: "now", "5m", "2h", "3d", "4w", "5mo", "2y". */
  protected relativeLabel(timestampMs: number): string {
    return formatRelativeShort(timestampMs, this.nowTick());
  }
}
