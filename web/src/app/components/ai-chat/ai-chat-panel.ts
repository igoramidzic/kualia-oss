import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  HostListener,
  inject,
  input,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import { AiChatService } from '../../services/ai-chat.service';
import { WorkspaceService } from '../../services/workspace.service';
import { AiChatEmptyStateComponent } from './ai-chat-empty-state';
import { AiChatInputComponent } from './ai-chat-input';
import { AiChatPanelHeaderComponent } from './ai-chat-panel-header';
import { AiChatTurnComponent } from './ai-chat-turn';
import { buildTurns, type Turn } from './build-turns';

@Component({
  selector: 'app-ai-chat-panel',
  imports: [AiChatPanelHeaderComponent, AiChatTurnComponent, AiChatInputComponent, AiChatEmptyStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ai-chat-panel.html',
  styleUrl: './ai-chat-panel.css',
  host: {
    class: 'relative flex min-h-0 flex-1 flex-col overflow-hidden',
    '[class.ai-chat-panel-expanded]': 'aiChat.expanded()',
  },
})
export class AiChatPanelComponent {
  protected readonly aiChat = inject(AiChatService);
  private readonly workspaceService = inject(WorkspaceService);

  /** Platform-aware label for the delete shortcut, shown next to the menu item. */
  protected readonly deleteShortcutLabel =
    typeof navigator !== 'undefined' && /Mac|iP(hone|od|ad)/.test(navigator.platform) ? '⌘⌫' : 'Ctrl+Del';

  /**
   * True while the launcher is mid-swap between chats. Drives an opacity fade applied only to the
   * messages list — the header and input field stay fully visible during the transition.
   */
  readonly swapping = input<boolean>(false);

  /**
   * Name shown in the card above the input. Resolves to the thread's pinned workspace context
   * when one exists (the label then always matches the workspace the agent is actually answering
   * from), or to the user's currently-active workspace on the pending-new-chat panel (so the
   * user sees what *will* be attached when they send). Returns null for legacy threads that
   * predate the context feature, OR when the user only belongs to a single workspace (the label
   * is redundant in that case), so the host template can hide the card entirely.
   */
  protected readonly workspaceName = computed<string | null>(() => {
    if (this.isSingleWorkspaceUser()) return null;
    const ctx = this.aiChat.workspaceContext();
    if (ctx) return ctx.workspaceName;
    if (this.aiChat.pendingNewChat()) return this.workspaceService.workspace()?.name ?? null;
    return null;
  });

  /**
   * True once we know the user only belongs to one workspace. Stays false until the count loads
   * (treat unknown as "show the chrome" so we don't briefly hide it on a multi-workspace user).
   */
  private readonly isSingleWorkspaceUser = computed(() => {
    const count = this.workspaceService.userWorkspaceCount();
    return count !== null && count <= 1;
  });

  /**
   * Workspace context to display under the first user message. Null for single-workspace users
   * (the chip would be redundant) and for threads without an attached context row.
   */
  protected readonly displayedWorkspaceContext = computed(() => {
    if (this.isSingleWorkspaceUser()) return null;
    return this.aiChat.workspaceContext();
  });

  /** True once the user has exhausted their monthly AI spend cap; gates the input + banner swap. */
  protected readonly limitReached = computed(() => this.aiChat.limitReached());

  private readonly scrollContainer = viewChild<ElementRef<HTMLDivElement>>('scrollContainer');
  private readonly turnEls = viewChildren('turnEl', { read: ElementRef });

  /** Pixel height of the scroll viewport, kept current via ResizeObserver. */
  protected readonly containerHeight = signal(0);

  protected readonly turns = computed<Turn[]>(() =>
    buildTurns({
      messages: this.aiChat.messages(),
      streamingMessages: this.aiChat.streamingMessages(),
      pendingUserPrompt: this.aiChat.pendingUserPrompt(),
      pendingAttachments: this.aiChat
        .pendingAttachments()
        .map((a) => ({ filename: a.filename, mediaType: a.mediaType })),
      isStreaming: this.aiChat.isStreaming(),
    })
  );

  protected readonly hasContent = computed(() => this.turns().length > 0);

  /** True when the current error is already rendered inside the last turn's assistant slot,
   *  so the bottom-of-scroll error block can suppress itself to avoid a duplicate. */
  protected readonly errorShownInTurn = computed(() => {
    if (!this.aiChat.error()) return false;
    const turns = this.turns();
    const last = turns[turns.length - 1];
    return !!last && !last.assistant;
  });

  /** Tracks turn count to detect new turns; bumped by the scroll effect after handling. */
  private previousTurnCount = 0;
  /** Tracks the active thread id so chat switches can land scrolled to the bottom. */
  private lastSeenThreadId: string | null = null;
  /** True after the user has sent at least one message in the current panel session.
   *  Lets us distinguish "opening an existing chat" (scroll to bottom) from "new-chat pivot
   *  after sending" (keep position). Also controls whether the last turn gets full-height
   *  min-height (only for turns added during this session, not pre-existing history). */
  protected hasSentInSession = false;
  /** When true, the next time turns become non-empty we scroll to the bottom instantly.
   *  Set on thread change; consumed once content arrives (watchers may deliver messages
   *  after the effect that detected the thread switch). */
  private pendingScrollToBottom = false;

  constructor() {
    // Track scroll container height so the last turn can use it as a pixel-based min-height.
    // Percentage-based min-height doesn't resolve inside overflow containers.
    effect((onCleanup) => {
      const el = this.scrollContainer()?.nativeElement;
      if (!el) return;
      const observer = new ResizeObserver(([entry]) => {
        this.containerHeight.set(Math.floor(entry.contentRect.height));
      });
      observer.observe(el);
      onCleanup(() => observer.disconnect());
    });

    effect(() => {
      // Track these so the effect re-runs as relevant state changes.
      const turns = this.turns();
      const threadId = this.aiChat.activeThreadId();
      const swapping = this.swapping();

      // Skip scroll work mid-swap — the fade hides the list and the post-swap effect run will
      // handle positioning once the new chat's content is in place.
      if (swapping) return;

      const threadChanged = threadId !== this.lastSeenThreadId;
      const turnAdded = turns.length > this.previousTurnCount;
      // "New chat pivot": the user just sent the first message on a pending-new-chat, so the
      // threadId flipped from null → real. Keep the scroll position — don't jump to bottom.
      // Only applies if the user has already sent in this session; otherwise (e.g. opening an
      // existing chat from minimized) we DO want scroll-to-bottom.
      const isNewChatPivot =
        threadChanged && this.lastSeenThreadId === null && threadId !== null && this.hasSentInSession;

      this.previousTurnCount = turns.length;
      this.lastSeenThreadId = threadId;

      if (threadChanged && !isNewChatPivot) {
        this.hasSentInSession = false;
        this.pendingScrollToBottom = true;
      }

      // Fulfill a pending scroll-to-bottom as soon as content is present.
      if (this.pendingScrollToBottom && turns.length > 0) {
        this.pendingScrollToBottom = false;
        requestAnimationFrame(() => {
          const el = this.scrollContainer()?.nativeElement;
          if (!el) return;
          el.scrollTop = el.scrollHeight;
          // Async content rendered just after the initial paint (transaction-link
          // cards resolving their merchant data, images decoding) grows the
          // scrollHeight a tick later and leaves the view slightly above the
          // bottom. Re-pin for ~400ms so the chat lands fully at the bottom on
          // open. Brief enough that a user starting to scroll during the window
          // barely notices.
          const start = performance.now();
          const pin = () => {
            const e = this.scrollContainer()?.nativeElement;
            if (!e) return;
            e.scrollTop = e.scrollHeight;
            if (performance.now() - start < 400) requestAnimationFrame(pin);
          };
          requestAnimationFrame(pin);
        });
        return;
      }

      if (threadChanged) return;

      if (turnAdded) {
        this.hasSentInSession = true;
        // New user message: smooth-scroll the new last turn to the top of the viewport.
        queueMicrotask(() => {
          const container = this.scrollContainer()?.nativeElement;
          const turnElList = this.turnEls();
          const lastTurnEl = turnElList[turnElList.length - 1]?.nativeElement as HTMLElement | undefined;
          if (container && lastTurnEl) {
            container.scrollTo({ top: lastTurnEl.offsetTop, behavior: 'smooth' });
          }
        });
      }
      // No-op on streaming-text growth: view stays put; user can scroll down if they want.
    });
  }

  protected minimize(): void {
    this.aiChat.minimize();
  }

  protected toggleExpand(): void {
    this.aiChat.toggleExpanded();
  }

  protected close(): void {
    const threadId = this.aiChat.activeThreadId();
    if (threadId) {
      void this.aiChat.closeChat(threadId);
    } else {
      this.aiChat.minimize();
    }
  }

  /** Permanently delete the active chat. No-op for the pending-new-chat panel (nothing to delete). */
  protected deleteActiveChat(): void {
    const threadId = this.aiChat.activeThreadId();
    if (!threadId) return;
    void this.aiChat.deleteChat(threadId);
  }

  /**
   * Cmd+Delete (mac) / Ctrl+Delete (Windows/Linux) deletes the active chat. Bound at the document
   * level so the shortcut fires from anywhere in the panel — except while the user is typing in
   * the prompt input or another editable field, where Cmd+Delete is the OS shortcut for
   * "delete to start of line" and the chat-delete would shadow it.
   */
  @HostListener('document:keydown', ['$event'])
  protected onKeydownShortcut(event: KeyboardEvent): void {
    if (event.key !== 'Delete' && event.key !== 'Backspace') return;
    if (!event.metaKey && !event.ctrlKey) return;
    if (!this.aiChat.activeThreadId()) return;
    if (this.isEditableTarget(event.target)) return;
    event.preventDefault();
    this.deleteActiveChat();
  }

  /** True when the keystroke is happening inside an input/textarea/contenteditable. */
  private isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA';
  }

  protected trackByTurnId(_index: number, turn: Turn): string {
    return turn.id;
  }
}
