import {
  afterNextRender,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  HostListener,
  inject,
  NgZone,
  signal,
  untracked,
  viewChild,
  viewChildren,
} from '@angular/core';
import { HlmButton } from '@spartan-ng/helm/button';
import {
  nucleoHistory as History,
  NucleoIcon,
  nucleoAssistant as MessageSquare,
  nucleoClose as X,
} from '@kualia/icons';
import { AiChatService, ThreadSummary } from '../../services/ai-chat.service';
import { ReportingService, TrackingEvent } from '../../services/reporting.service';
import { AiChatHistoryComponent, HistorySelectEvent } from './ai-chat-history';
import { AiChatPanelComponent } from './ai-chat-panel';

const NEW_CHAT_KEY = 'new';
const PANEL_WIDTH = 380;
const EDGE_PADDING = 8;
const FADE_MS = 150;
/** Duration of the panel container's open/close animation; matches Tailwind `duration-200`. */
const CLOSE_MS = 200;
/** Mirrors the original `right-4` viewport offset, used as a fallback when no click rect is available. */
const DEFAULT_RIGHT_PADDING = 16;

@Component({
  selector: 'app-ai-chat-launcher',
  imports: [HlmButton, NucleoIcon, AiChatPanelComponent, AiChatHistoryComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ai-chat-launcher.html',
  styleUrl: './ai-chat-launcher.css',
})
export class AiChatLauncherComponent {
  protected readonly aiChat = inject(AiChatService);
  private readonly reporting = inject(ReportingService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly ngZone = inject(NgZone);
  private readonly cdr = inject(ChangeDetectorRef);

  protected readonly MessageSquare = MessageSquare;
  protected readonly History = History;
  protected readonly X = X;
  protected readonly newChatKey = NEW_CHAT_KEY;

  private readonly container = viewChild<ElementRef<HTMLDivElement>>('container');
  private readonly askKualiaBtn = viewChild<ElementRef<HTMLButtonElement>>('askKualiaBtn');
  private readonly measureTabs = viewChildren<ElementRef<HTMLButtonElement>>('measureTab');
  private readonly measureHistory = viewChild<ElementRef<HTMLButtonElement>>('measureHistory');

  /**
   * Tabs to render in the bottom bar. Threads without a title yet are omitted — when the user
   * sends the first message, the agent generates a title shortly after; we'd rather wait for
   * that than show a "New chat" placeholder that pops in for half a second and then renames.
   */
  protected readonly activeThreads = computed<ThreadSummary[]>(() =>
    this.aiChat.threadList().active.filter((t) => !!t.title?.trim())
  );
  protected readonly archivedThreads = computed<ThreadSummary[]>(() => this.aiChat.threadList().archived);

  /** Composite key identifying which item is active: a threadId or NEW_CHAT_KEY, or null when minimized. */
  protected readonly activeKey = computed<string | null>(() => {
    if (this.aiChat.pendingNewChat()) return NEW_CHAT_KEY;
    return this.aiChat.activeThreadId();
  });

  /**
   * Available width inside the bar's container, in pixels. Tracked via ResizeObserver and updated
   * when measurements settle. Zero until the first measure pass — `visibleThreads` falls back to
   * "show everything" while we don't know the width yet, so initial render isn't visibly empty.
   */
  private readonly availableWidth = signal<number>(0);
  /** Per-thread natural button width (capped by max-w-[160px]). Measured in the offscreen layer. */
  private readonly tabWidths = signal<ReadonlyMap<string, number>>(new Map());
  private readonly askKualiaWidth = signal<number>(0);
  private readonly historyButtonWidth = signal<number>(0);
  private gap = 4;

  /**
   * Tabs to render in the bar. Packs as many recent tabs as fit, then guarantees the active tab
   * is visible by replacing the last visible slot with it if it would otherwise overflow into the
   * dropdown — same UX as ResponsiveFilterRow's "active filter is always reachable" behavior.
   */
  protected readonly visibleThreads = computed<ThreadSummary[]>(() => {
    const all = this.activeThreads();
    const archived = this.archivedThreads();
    const available = this.availableWidth();
    if (available <= 0 || all.length === 0) return all;

    const askSpace = this.askKualiaWidth() + this.gap;
    const historySpace = this.historyButtonWidth() + this.gap;

    // First pass: assume no history button (only needed if archived exists OR we end up overflowing).
    const tentativeBudget = available - askSpace - (archived.length > 0 ? historySpace : 0);
    let fit = this.fitTabs(all, tentativeBudget);

    if (fit.length < all.length) {
      // Will overflow → history button is required, recompute with its space reserved.
      fit = this.fitTabs(all, available - askSpace - historySpace);
    }

    const activeId = this.aiChat.activeThreadId();
    if (activeId && !fit.some((t) => t.threadId === activeId)) {
      const activeThread = all.find((t) => t.threadId === activeId);
      if (activeThread) {
        if (fit.length > 0) fit[fit.length - 1] = activeThread;
        else fit = [activeThread];
      }
    }
    return fit;
  });

  /** Active threads that didn't fit and got pushed into the history dropdown. */
  protected readonly hiddenThreads = computed<ThreadSummary[]>(() => {
    const visibleIds = new Set(this.visibleThreads().map((t) => t.threadId));
    return this.activeThreads().filter((t) => !visibleIds.has(t.threadId));
  });

  /** Combined list shown in the history popover: hidden-but-active first, then archived. */
  protected readonly historyThreads = computed<ThreadSummary[]>(() => [
    ...this.hiddenThreads(),
    ...this.archivedThreads(),
  ]);

  private fitTabs(threads: ThreadSummary[], budget: number): ThreadSummary[] {
    if (budget <= 0) return [];
    const widths = this.tabWidths();
    const result: ThreadSummary[] = [];
    let total = 0;
    for (let i = 0; i < threads.length; i++) {
      const w = widths.get(threads[i].threadId) ?? 80;
      const widthWithGap = i === 0 ? w : w + this.gap;
      if (total + widthWithGap > budget) break;
      total += widthWithGap;
      result.push(threads[i]);
    }
    return result;
  }

  /**
   * Pixel offset from the viewport's left edge for the panel container. `null` until a user-initiated
   * click sets it; the panel falls back to `defaultLeftPx()` (mirroring the original `right-4`).
   *
   * Updated only on user clicks (`onTabClick`, `reopenFromHistory`) — never as a reaction to
   * `activeKey()` changes — so the auto-`selectChat` triggered by `sendMessage` doesn't move the
   * panel when a brand-new active-chat tab gets inserted into the bar.
   */
  protected readonly panelLeftPx = signal<number | null>(null);

  /** True while the inner content is mid-swap; drives the opacity-0 fade-out. */
  protected readonly isContentSwapping = signal<boolean>(false);

  /**
   * Inline `top/left/width/height` for the panel. Both floating and expanded modes emit the same
   * property set (in pixels) so `transition-all` interpolates between them smoothly — the panel
   * grows out from the bottom-right floating spot rather than snapping its top to 0 first.
   *
   * Re-runs on every `chatPanelTargetRect` change (which the layout republishes on window resize),
   * so the floating values stay accurate as the viewport shrinks/grows.
   */
  protected readonly panelStyles = computed<Record<string, string>>((): Record<string, string> => {
    const targetRect = this.aiChat.chatPanelTargetRect();
    if (this.aiChat.expanded()) {
      if (!targetRect) return {};
      const TOP_PEEK = 5;
      return {
        top: `${targetRect.top + TOP_PEEK}px`,
        left: `${targetRect.left}px`,
        width: `${targetRect.width}px`,
        height: `${targetRect.height - TOP_PEEK}px`,
      };
    }
    // Floating: compute absolute pixel rect from viewport + Tailwind defaults so we can transition
    // between this and the expanded rect without switching positioning specs (top vs bottom).
    const FLOATING_HEIGHT = 520;
    const FLOATING_WIDTH = 380;
    const FLOATING_BOTTOM = 48; // matches `bottom-12`
    const VIEWPORT_PADDING_X = 32; // matches `max-w-[calc(100vw-2rem)]`
    const VIEWPORT_MAX_H_RATIO = 0.8; // matches `max-h-[80vh]`
    const viewportH = window.innerHeight;
    const viewportW = window.innerWidth;
    const height = Math.min(FLOATING_HEIGHT, viewportH * VIEWPORT_MAX_H_RATIO);
    const width = Math.min(FLOATING_WIDTH, viewportW - VIEWPORT_PADDING_X);
    const top = viewportH - FLOATING_BOTTOM - height;
    const left = this.panelLeftPx() ?? this.defaultLeftPx();
    return {
      top: `${top}px`,
      left: `${left}px`,
      width: `${width}px`,
      height: `${height}px`,
    };
  });

  /**
   * ThreadId we're waiting to anchor the panel to. Set when the user reopens from history (the
   * tab button doesn't exist yet at click time, so we can't measure it). Cleared once the tab
   * renders and the panel is anchored, or when another open path sets a position directly.
   */
  private readonly pendingAnchorThreadId = signal<string | null>(null);

  /**
   * The key currently rendered in the DOM. Lags behind `activeKey()` only on close: when the
   * service flips active to null, we keep `_displayKey` set for `CLOSE_MS` so the panel can play
   * its close transition (the reverse of the open) before being removed.
   */
  private readonly _displayKey = signal<string | null>(null);
  protected readonly displayKey = this._displayKey.asReadonly();

  /**
   * Drives the open/close CSS transition on the panel container.
   *
   * - When false: panel is at `opacity-0 scale-95` (transitioned-out state).
   * - When true: panel is at `opacity-100 scale-100` (open).
   *
   * Open: mount with `false`, then flip to `true` on the next animation frame so the transition
   * runs (a same-frame change wouldn't animate — the browser would only see the end state).
   * Close: flip to `false`, leave the panel mounted for `CLOSE_MS` so the transition can run, then
   * unmount via `_displayKey`.
   */
  private readonly _isOpen = signal<boolean>(false);
  protected readonly isOpen = this._isOpen.asReadonly();

  private swapTimer: ReturnType<typeof setTimeout> | null = null;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  private openFrameHandle: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private isDestroyed = false;

  constructor() {
    effect(() => {
      const key = this.activeKey();
      untracked(() => this.syncDisplayState(key));
    });

    afterNextRender(() => {
      requestAnimationFrame(() => {
        if (this.isDestroyed) return;

        this.ngZone.run(() => {
          this.measureLayout();
          this.setupResizeObserver();
        });
      });
    });

    // Re-measure tab widths when the active thread list changes (titles, additions, removals).
    effect(() => {
      this.activeThreads();
      requestAnimationFrame(() => {
        if (this.isDestroyed) return;

        this.ngZone.run(() => this.measureLayout());
      });
    });

    // Anchor-on-render: once a pending threadId shows up in activeThreads() (i.e. the
    // reopen mutation has settled and the threadList watcher has pushed the update), wait one
    // frame for the @for to render the tab, then anchor the panel to the tab's *final* size.
    //
    // The wrapper's enter animation interpolates `max-width: 0 → natural`, so reading the rect
    // mid-animation would clamp the panel to the viewport's right edge. We seek each running
    // animation to its end, measure, then restore — synchronous so no paint happens with the
    // element in its final state. This lets the panel slide in alongside the tab's growth
    // instead of waiting for it to finish.
    effect(() => {
      const pending = this.pendingAnchorThreadId();
      if (!pending) return;
      const present = this.activeThreads().some((t) => t.threadId === pending);
      if (!present) return;
      requestAnimationFrame(() => {
        const tab = this.host.nativeElement.querySelector<HTMLElement>(`[data-thread-id="${pending}"]`);
        if (!tab) return;
        const wrapper = tab.parentElement;
        const anims = wrapper?.getAnimations() ?? [];
        const finalRect = this.measureAtAnimationEnd(tab, anims);
        this.panelLeftPx.set(this.computePanelLeftFromRight(finalRect.right));
        this.pendingAnchorThreadId.set(null);
      });
    });

    this.destroyRef.onDestroy(() => {
      this.isDestroyed = true;
      if (this.swapTimer !== null) clearTimeout(this.swapTimer);
      if (this.closeTimer !== null) clearTimeout(this.closeTimer);
      if (this.openFrameHandle !== null) cancelAnimationFrame(this.openFrameHandle);
      this.resizeObserver?.disconnect();
      this.resizeObserver = null;
    });
  }

  /** Read the gap, container width, and per-element widths from the offscreen measurement layer. */
  private measureLayout(): void {
    const containerEl = this.container()?.nativeElement;
    if (!containerEl) return;

    const computed = window.getComputedStyle(containerEl);
    this.gap = parseFloat(computed.gap) || 4;

    const widths = new Map<string, number>();
    for (const ref of this.measureTabs()) {
      const el = ref.nativeElement;
      const id = el.getAttribute('data-measure-thread-id');
      if (id) widths.set(id, el.offsetWidth);
    }
    this.tabWidths.set(widths);

    const askEl = this.askKualiaBtn()?.nativeElement;
    if (askEl) this.askKualiaWidth.set(askEl.offsetWidth);

    const historyEl = this.measureHistory()?.nativeElement;
    if (historyEl) this.historyButtonWidth.set(historyEl.offsetWidth);

    if (containerEl.clientWidth > 0) this.availableWidth.set(containerEl.clientWidth);
    this.cdr.markForCheck();
  }

  private setupResizeObserver(): void {
    if (this.isDestroyed || this.resizeObserver) return;

    const containerEl = this.container()?.nativeElement;
    if (!containerEl) return;
    if (typeof ResizeObserver === 'undefined') return;

    this.resizeObserver = new ResizeObserver(() => {
      this.ngZone.run(() => this.measureLayout());
    });
    this.resizeObserver.observe(containerEl);
  }

  private syncDisplayState(key: string | null): void {
    if (key !== null) {
      // Opening (or switching): cancel any in-flight close.
      if (this.closeTimer !== null) {
        clearTimeout(this.closeTimer);
        this.closeTimer = null;
      }

      const wasMounted = this._displayKey() !== null;
      this._displayKey.set(key);

      if (wasMounted) {
        // Already on screen (chat switch or close-cancel) — keep it visible, no entry animation.
        this._isOpen.set(true);
      } else {
        // Fresh mount: paint at the "from" state, then flip to "to" on the next frame so the
        // CSS transition actually runs. Without the rAF gap the browser collapses both states
        // into one paint and the open looks instant.
        this._isOpen.set(false);
        if (this.openFrameHandle !== null) cancelAnimationFrame(this.openFrameHandle);
        this.openFrameHandle = requestAnimationFrame(() => {
          this._isOpen.set(true);
          this.openFrameHandle = null;
        });
      }
    } else if (this._displayKey() !== null) {
      // Closing: cancel any pending open frame, flip to "from" state, unmount after the transition.
      if (this.openFrameHandle !== null) {
        cancelAnimationFrame(this.openFrameHandle);
        this.openFrameHandle = null;
      }
      this._isOpen.set(false);
      if (this.closeTimer !== null) clearTimeout(this.closeTimer);
      this.closeTimer = setTimeout(() => {
        this._displayKey.set(null);
        this.closeTimer = null;
      }, CLOSE_MS);
    }
  }

  protected onTabClick(event: MouseEvent, key: string, titleHint: string | null = null): void {
    const current = this.activeKey();

    // Same key → toggle off (minimize). Mirrors prior behavior.
    if (current === key) {
      this.aiChat.minimize();
      return;
    }

    const button = event.currentTarget as HTMLElement | null;
    if (button) this.panelLeftPx.set(this.computePanelLeft(button));
    this.pendingAnchorThreadId.set(null);

    if (current === null) {
      // Opening from minimized: panel mounts at the new position; the container's existing
      // animate-in/fade-in/zoom-in classes handle the entrance. No content swap needed.
      this.openInService(key, { titleHint });
      return;
    }

    // Already open and switching to a different key: fade content out, swap, fade back in.
    // Position update above runs in parallel via the panel's transition-[left].
    this.scheduleContentSwap(key, { titleHint });
  }

  /** Bridge from the history popover. We don't have a click event to anchor off, so the
   *  pending-anchor effect handles positioning once the tab renders. Hidden-but-active threads
   *  (overflowed out of the bar) just need a select; only archived threads need the reopen mutation. */
  protected onHistorySelect(event: HistorySelectEvent): void {
    const isArchived = this.archivedThreads().some((t) => t.threadId === event.threadId);
    if (isArchived) {
      this.reopenFromHistory(null, event.threadId, event.title);
      return;
    }
    // Hidden-but-active: select. visibleThreads will bump it into the bar via the active override.
    this.pendingAnchorThreadId.set(event.threadId);
    if (this.activeKey() === null) {
      this.aiChat.selectChat(event.threadId, event.title);
    } else {
      this.scheduleContentSwap(event.threadId, { titleHint: event.title });
    }
  }

  protected reopenFromHistory(_event: MouseEvent | null, threadId: string, titleHint: string | null = null): void {
    const current = this.activeKey();

    // Don't anchor off the dropdown menu item — its rect is wherever the popover sits, not where
    // the new tab button will land. Mark this threadId as pending anchor; the effect below will
    // position the panel once the tab appears in activeThreads() and renders.
    this.pendingAnchorThreadId.set(threadId);

    if (current === null) {
      void this.aiChat.reopenFromHistory(threadId, titleHint);
      return;
    }

    // Schedule the same fade-out → reopen → fade-in flow used for tab switches.
    this.scheduleContentSwap(threadId, { viaHistory: true, titleHint });
  }

  protected archiveChat(event: Event, threadId: string): void {
    event.stopPropagation();
    event.preventDefault();
    void this.aiChat.closeChat(threadId);
  }

  /**
   * Close on Escape — only when the prompt textarea has focus, so Escape on chat history items,
   * the header buttons, or the page itself can't accidentally minimize a chat the user is just
   * skimming. The keystroke must come from inside the prompt input itself.
   *
   * Explicitly stops propagation so no other document-level handler (tooltip dismissal, popover
   * Brn handlers, page-level shortcuts) can also react to the same Escape and accidentally trigger
   * a side-effect on the in-flight chat (e.g. focus jumps that fire a stray click on the stop
   * button). Escape on the chat must ONLY minimize — never abort the streaming response.
   */
  @HostListener('document:keydown.escape', ['$event'])
  protected onEscape(event: Event): void {
    if (!this.activeKey()) return;
    const target = event.target;
    if (!(target instanceof Element) || !target.matches('[data-ai-chat-prompt]')) return;
    event.preventDefault();
    event.stopPropagation();
    this.aiChat.minimize();
  }

  /** Default left offset that matches the original `right-4` (1rem from viewport right). */
  protected defaultLeftPx(): number {
    return Math.max(EDGE_PADDING, window.innerWidth - PANEL_WIDTH - DEFAULT_RIGHT_PADDING);
  }

  /**
   * Compute the panel's `left` so its right edge is flush with the button's right edge,
   * clamped so it never overflows either viewport edge.
   */
  private computePanelLeft(buttonEl: HTMLElement): number {
    return this.computePanelLeftFromRight(buttonEl.getBoundingClientRect().right);
  }

  /** Same as computePanelLeft, but takes a precomputed right-edge x-coordinate. */
  private computePanelLeftFromRight(right: number): number {
    const desired = right - PANEL_WIDTH;
    const max = window.innerWidth - PANEL_WIDTH - EDGE_PADDING;
    return Math.round(Math.max(EDGE_PADDING, Math.min(desired, max)));
  }

  /**
   * Read an element's bounding rect as if any in-flight Web Animations on `anims` had finished,
   * then restore each animation's playhead. Done synchronously so layout never paints with the
   * element in its final state — only `getBoundingClientRect` sees it. Used to anchor the panel
   * to a tab's final size while its enter animation is still running.
   */
  private measureAtAnimationEnd(el: HTMLElement, anims: readonly Animation[]): DOMRect {
    if (anims.length === 0) return el.getBoundingClientRect();
    const originalTimes = anims.map((a) => a.currentTime);
    for (const a of anims) {
      const duration = (a.effect?.getComputedTiming?.()?.duration as number | undefined) ?? 0;
      a.currentTime = duration;
    }
    const rect = el.getBoundingClientRect();
    anims.forEach((a, i) => {
      a.currentTime = originalTimes[i];
    });
    return rect;
  }

  /** Open or select the target key in the service, forwarding the title hint when applicable. */
  private openInService(key: string, opts: { viaHistory?: boolean; titleHint?: string | null } = {}): void {
    const titleHint = opts.titleHint ?? null;
    const source: 'new' | 'history' | 'tab' = key === NEW_CHAT_KEY ? 'new' : opts.viaHistory ? 'history' : 'tab';
    this.reporting.capture(TrackingEvent.AI_CHAT_OPENED, {
      source,
      thread_id: key === NEW_CHAT_KEY ? null : key,
    });

    if (key === NEW_CHAT_KEY) {
      this.aiChat.openNewChat();
    } else if (opts.viaHistory) {
      void this.aiChat.reopenFromHistory(key, titleHint);
    } else {
      this.aiChat.selectChat(key, titleHint);
    }
  }

  /**
   * Fade the current content out, swap to the target key, then fade back in.
   * Cancels any in-flight swap so the latest click always wins.
   *
   * The header title is swapped on its own (faster) timer via `setNextTitle` so it doesn't lag
   * the click — we already know the upcoming title from the bottom-bar tab.
   */
  private scheduleContentSwap(key: string, opts: { viaHistory?: boolean; titleHint?: string | null } = {}): void {
    const nextTitle = key === NEW_CHAT_KEY ? null : (opts.titleHint ?? null);
    this.aiChat.setNextTitle(nextTitle);

    this.isContentSwapping.set(true);
    if (this.swapTimer !== null) clearTimeout(this.swapTimer);
    this.swapTimer = setTimeout(() => {
      this.openInService(key, opts);
      this.isContentSwapping.set(false);
      this.swapTimer = null;
    }, FADE_MS);
  }
}
