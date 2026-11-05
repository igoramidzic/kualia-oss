import { computed, DestroyRef, effect, inject, Injectable, signal } from '@angular/core';
import { api } from 'convex/_generated/api';
import { Id } from 'convex/_generated/dataModel';
import { FunctionReturnType } from 'convex/server';
import {
  encodeKualiaAttachmentsTag,
  stripKualiaAttachmentBodyTags,
  stripKualiaAttachmentsTag,
} from '../components/ai-chat/attachments-tag';
import {
  encodeKualiaContextTag,
  parseKualiaContextTag,
  stripKualiaContextTag,
} from '../components/ai-chat/workspace-context-tag';
import { ConvexService } from './convex.service';
import { ReportingService, TrackingEvent } from './reporting.service';
import { WorkspaceService } from './workspace.service';

export type ListMessagesResponse = FunctionReturnType<typeof api.aiChat.listMessages>;
export type ChatMessage = ListMessagesResponse['page'][number];
export type StreamingMessages = FunctionReturnType<typeof api.aiChat.streamMessages>;
export type ThreadInfo = FunctionReturnType<typeof api.aiChat.getThreadInfo>;
export type ThreadList = FunctionReturnType<typeof api.aiChat.listThreads>;
export type ThreadSummary = ThreadList['active'][number];
export type UsageSummary = FunctionReturnType<typeof api.aiChat.getCurrentUsage>;

export interface ChatAttachment {
  storageId: Id<'_storage'>;
  mediaType: string;
  filename: string;
}

export interface ThreadWorkspaceContext {
  workspaceId: Id<'workspace'>;
  workspaceName: string;
}

/**
 * One file the user has dropped/attached to a draft, tracked through its upload lifecycle so the
 * panel can disable send while uploads are in flight and surface error chips inline.
 */
export interface ChatDraftAttachment {
  id: string;
  filename: string;
  size: number;
  mediaType: string;
  status: 'uploading' | 'ready' | 'error';
  /** Resolved upload metadata, present once `status === 'ready'`. */
  metadata: ChatAttachment | null;
  /** Error message when `status === 'error'`. */
  error: string | null;
}

/** Per-conversation draft preserved across chat switches and panel minimize. */
export interface ChatDraft {
  text: string;
  attachments: readonly ChatDraftAttachment[];
}

/** Map key for the pending-new-chat panel's draft (no thread id exists yet). */
export const NEW_CHAT_DRAFT_KEY = '__new-chat__';

const EMPTY_DRAFT: ChatDraft = Object.freeze({
  text: '',
  attachments: Object.freeze([]),
});

const MESSAGE_PAGE_SIZE = 50;

/** Mirrors `MAX_CHAT_ATTACHMENT_BYTES` in `convex/storage/chatAttachmentUpload.ts`. */
export const MAX_CHAT_ATTACHMENT_BYTES = 10 * 1024 * 1024;

interface ThreadCacheEntry {
  messages: ChatMessage[];
  streamingMessages: StreamingMessages;
  title: string | null;
  /** Last-resolved workspace context for this thread; restored on re-select to avoid card flicker. */
  workspaceContext?: ThreadWorkspaceContext | null;
}

@Injectable({
  providedIn: 'root',
})
export class AiChatService {
  private readonly convexService = inject(ConvexService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly workspaceService = inject(WorkspaceService);
  private readonly reporting = inject(ReportingService);

  private readonly _pendingNewChat = signal<boolean>(false);
  private readonly _activeThreadId = signal<string | null>(null);
  /** localStorage key for the expanded-mode preference; persisted across minimize/reopen and reloads. */
  private readonly EXPANDED_STORAGE_KEY = 'ai-chat:expanded';
  /**
   * Stored expanded preference. Persisted to localStorage; survives minimize, archive, and reload
   * so reopening lands in the same mode. Read effective expanded state via `expanded()` instead —
   * it gates on the panel actually being shown so the layout doesn't keep its shrunken padding
   * after the panel is hidden (e.g. via Escape).
   */
  private readonly _expanded = signal<boolean>(this.loadExpandedFromStorage());
  /**
   * Effective expanded state — true only when the user prefers expanded AND the panel is currently
   * shown. Used by the layout (extra padding) and the panel itself (sizing). Falls back to false
   * whenever the panel is minimized so the content card returns to its full size.
   */
  readonly expanded = computed(() => this._expanded() && (this._pendingNewChat() || this._activeThreadId() !== null));
  /**
   * Viewport-relative rect the expanded chat panel should occupy — reflects where the page's
   * main content card sits in its DEFAULT (un-expanded) layout, not its current size. The layout
   * publishes this so the panel keeps the original content-card width even while the underlying
   * card visually shrinks behind it.
   */
  private readonly _chatPanelTargetRect = signal<{ top: number; left: number; width: number; height: number } | null>(
    null
  );
  readonly chatPanelTargetRect = this._chatPanelTargetRect.asReadonly();
  private readonly _messages = signal<ChatMessage[]>([]);
  private readonly _streamingMessages = signal<StreamingMessages>([]);
  private readonly _title = signal<string | null>(null);
  /**
   * Optimistic seed for the workspace-context chip while the first send is in flight, before
   * the persisted user message (which carries the embedded `<kualia-context>` tag) arrives via
   * the watcher. Cleared once the first message lands so `workspaceContext` reads from history.
   */
  private readonly _seededWorkspaceContext = signal<ThreadWorkspaceContext | null>(null);
  private readonly _rawThreadList = signal<ThreadList>({ active: [], archived: [] });
  private readonly _usage = signal<UsageSummary | null>(null);
  /**
   * Optimistic status overrides applied on top of the server-side thread list. Set when the user
   * archives or reopens a thread so the bottom-bar updates immediately; an entry is removed once
   * the watcher pushes a server state that matches the override.
   */
  private readonly _optimisticStatus = signal<ReadonlyMap<string, 'active' | 'archived'>>(new Map());
  /**
   * Threads the user has just opened — the dot is locally suppressed even before the
   * `markThreadRead` mutation lands and the watcher re-emits with `unread: false`. An entry is
   * removed in `reconcileOptimisticRead` once the server confirms.
   */
  private readonly _optimisticRead = signal<ReadonlySet<string>>(new Set());
  /**
   * Set of thread keys with an in-flight `sendMessage` action. Keyed by `threadId` for existing
   * chats and `NEW_CHAT_DRAFT_KEY` for the pending-new-chat panel. Per-thread (rather than the
   * old singleton boolean) so switching to a different chat while one is mid-send doesn't bleed
   * the streaming UI (stop button + thinking shimmer + optimistic bubble) onto the idle chat.
   */
  private readonly _pendingSends = signal<ReadonlySet<string>>(new Set());
  private readonly _error = signal<string | null>(null);
  /** Optimistic prompt text per in-flight thread key (see `_pendingSends`). */
  private readonly _pendingPromptByThread = signal<ReadonlyMap<string, string>>(new Map());
  /**
   * Optimistic attachments sent on the in-flight message per thread key, surfaced as chips above
   * the optimistic user bubble. Cleared once the persisted user message arrives (the watcher's
   * payload carries the same names via the embedded `<kualia-attachments>` tag).
   */
  private readonly _pendingAttachmentsByThread = signal<ReadonlyMap<string, readonly ChatAttachment[]>>(new Map());
  /**
   * True while the panel has an active thread but the message watcher hasn't yielded yet (and no
   * cache entry exists to fill in instantly). Drives the messages-list fade-in in the panel.
   */
  private readonly _messagesLoading = signal<boolean>(false);
  /**
   * Pulses true for one fade-out cycle while the header swaps to the next chat's title. The
   * launcher triggers this at swap start so the header transitions in parallel with (and finishes
   * sooner than) the messages fade.
   */
  private readonly _titleSwapping = signal<boolean>(false);
  private titleSwapTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Composer state (typed text + chosen-but-not-yet-sent attachments) per conversation. Keyed by
   * threadId for existing chats and `NEW_CHAT_DRAFT_KEY` for the pending-new-chat panel. Lives on
   * the (singleton) service so it survives chat switches and panel minimize/reopen.
   */
  private readonly _drafts = signal<ReadonlyMap<string, ChatDraft>>(new Map());

  readonly pendingNewChat = this._pendingNewChat.asReadonly();
  readonly activeThreadId = this._activeThreadId.asReadonly();
  readonly title = this._title.asReadonly();
  readonly error = this._error.asReadonly();
  readonly messagesLoading = this._messagesLoading.asReadonly();
  readonly titleSwapping = this._titleSwapping.asReadonly();

  /** Current calendar-month spend summary for the signed-in user. Null until first watcher tick. */
  readonly usage = this._usage.asReadonly();
  /** True once the user's monthly $ cap has been reached — gates send + drives the danger banner. */
  readonly limitReached = computed(() => this._usage()?.limitReached ?? false);

  /** Server-side thread list with any in-flight optimistic status overrides applied. */
  readonly threadList = computed<ThreadList>(() => {
    const raw = this._rawThreadList();
    const overrides = this._optimisticStatus();
    if (overrides.size === 0) return raw;
    const active: ThreadSummary[] = [];
    const archived: ThreadSummary[] = [];
    for (const t of raw.active) {
      if (overrides.get(t.threadId) === 'archived') archived.push(t);
      else active.push(t);
    }
    for (const t of raw.archived) {
      if (overrides.get(t.threadId) === 'active') active.push(t);
      else archived.push(t);
    }
    // Match the server's newest-first ordering so an optimistically-moved thread lands in its
    // final position immediately. Without this, push() drops it at the end of the list and the
    // tab visibly jumps to its real slot once the watcher confirms.
    active.sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt);
    archived.sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt);
    return { active, archived };
  });

  /**
   * Set of threadIds with unseen assistant output. Computed from the server's per-thread `unread`
   * flag, with locally-cleared threads (just opened, mutation in flight) filtered out so the dot
   * disappears the instant the user clicks. The currently active thread is also excluded — its
   * panel is on screen, so the dot would be visual noise; an effect below auto-fires
   * `markThreadRead` to keep the server's read state in sync.
   */
  readonly unreadThreads = computed<ReadonlySet<string>>(() => {
    const raw = this._rawThreadList();
    const optimistic = this._optimisticRead();
    const activeId = this._activeThreadId();
    const out = new Set<string>();
    for (const t of raw.active) {
      if (t.unread && !optimistic.has(t.threadId) && t.threadId !== activeId) out.add(t.threadId);
    }
    for (const t of raw.archived) {
      if (t.unread && !optimistic.has(t.threadId) && t.threadId !== activeId) out.add(t.threadId);
    }
    return out;
  });

  /** True when either an active chat panel or the pending new-chat panel is shown. */
  readonly isPanelOpen = computed(() => this._activeThreadId() !== null || this._pendingNewChat());

  /**
   * True when the expanded chat panel currently owns the keyboard — page-level shortcuts (Cmd+F
   * search focus, number-key filters, Cmd+A select-all on transactions/budget) should bail out so
   * they don't fire from underneath the chat. We only override when the panel is open *and*
   * expanded (in compact mode the chat is a small floater that the user clearly didn't drive into)
   * and only when focus actually sits inside the dialog — clicking out into the page hands control
   * back to the page's shortcuts.
   */
  shouldCaptureShortcuts(): boolean {
    if (!this.isPanelOpen() || !this.expanded()) return false;
    if (typeof document === 'undefined') return false;
    const active = document.activeElement;
    if (!active || active === document.body) return false;
    return active.closest('[data-ai-chat-dialog]') !== null;
  }

  /**
   * Composite key identifying which draft slot is "active" right now: a threadId for existing
   * chats, `NEW_CHAT_DRAFT_KEY` for the pending-new-chat panel, or null when the panel is closed.
   */
  readonly activeDraftKey = computed<string | null>(() => {
    const id = this._activeThreadId();
    if (id !== null) return id;
    if (this._pendingNewChat()) return NEW_CHAT_DRAFT_KEY;
    return null;
  });

  /** Draft (text + attachments) for the active panel, or an empty draft when nothing is active. */
  readonly currentDraft = computed<ChatDraft>(() => {
    const key = this.activeDraftKey();
    if (!key) return EMPTY_DRAFT;
    return this._drafts().get(key) ?? EMPTY_DRAFT;
  });

  /** True while the panel's current chat has an in-flight send action. Per-thread. */
  readonly isSending = computed<boolean>(() => {
    const key = this.activeDraftKey();
    return key !== null && this._pendingSends().has(key);
  });

  /** Set of thread keys with an in-flight send — drives the bottom-bar tab title shimmer. */
  readonly pendingThreads = this._pendingSends.asReadonly();

  /** Optimistic user message text for the panel's current chat, cleared once the real one arrives. */
  readonly pendingUserPrompt = computed<string | null>(() => {
    const key = this.activeDraftKey();
    if (!key) return null;
    return this._pendingPromptByThread().get(key) ?? null;
  });

  /** Optimistic attachments for the panel's current chat, shown above the pending user bubble. */
  readonly pendingAttachments = computed<readonly ChatAttachment[]>(() => {
    const key = this.activeDraftKey();
    if (!key) return [];
    return this._pendingAttachmentsByThread().get(key) ?? [];
  });

  /** Messages sorted oldest → newest, ready to render top-to-bottom. */
  readonly messages = computed(() => {
    const list = [...this._messages()];
    list.sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      return a.stepOrder - b.stepOrder;
    });
    return list;
  });

  readonly streamingMessages = this._streamingMessages.asReadonly();

  /** True when a response is generating (action in flight or stream still active) on the active chat. */
  readonly isStreaming = computed(() => this.isSending() || this._streamingMessages().length > 0);

  /**
   * Stateful workspace-context display value. Updated by the effect below as soon as messages
   * deliver a definitive answer, restored from `threadCache` on chat switches, and held steady
   * during the cache-miss → watcher-arrival window so the workspace card doesn't flicker out
   * and back when switching to a chat that hasn't been opened in this session yet.
   */
  private readonly _displayedWorkspaceContext = signal<ThreadWorkspaceContext | null>(null);

  /**
   * Workspace this thread was opened against, surfaced as a chip under the first user message.
   * Prefers the cached "displayed" value (set by the effect once messages resolve, and held
   * across chat switches so the chip doesn't flicker), and falls back to the optimistic seed so
   * the chip appears synchronously during the first send before the effect has run.
   */
  readonly workspaceContext = computed<ThreadWorkspaceContext | null>(() => {
    return this._displayedWorkspaceContext() ?? this._seededWorkspaceContext();
  });

  /**
   * Pure derivation from the active thread's loaded messages. Returns the parsed `<kualia-context>`
   * payload from the first user message; null for legacy threads (first user message present but
   * no tag). Returns `undefined` when we can't yet tell — no user message has loaded — so the
   * caller can choose between "fall back to seed" and "keep the previous displayed value".
   */
  private readonly _workspaceContextFromMessages = computed<ThreadWorkspaceContext | null | undefined>(() => {
    const list = this.messages();
    for (const m of list) {
      if (m.message?.role !== 'user') continue;
      const parsed = parseKualiaContextTag(m.text ?? '');
      if (parsed) {
        return { workspaceId: parsed.workspaceId as Id<'workspace'>, workspaceName: parsed.workspaceName };
      }
      return null;
    }
    return undefined;
  });

  private messagesSubscription?: () => void;
  private streamSubscription?: () => void;
  private threadInfoSubscription?: () => void;
  private threadListSubscription?: () => void;
  private usageSubscription?: () => void;

  /**
   * Per-thread cache of the last-seen messages, streaming, and title. Lets us re-show a thread's
   * content instantly on switch (no flash of empty state while watchers warm up) and seed the
   * title from the bottom-bar entry on a first visit so the header doesn't briefly read "New chat".
   */
  private readonly threadCache = new Map<string, ThreadCacheEntry>();

  constructor() {
    // Persist expanded-mode preference so reopening the panel (after minimize, archive, or page
    // reload) lands in the same mode. Defaults to false on first run via the field initializer.
    effect(() => {
      this.saveExpandedToStorage(this._expanded());
    });

    effect(() => {
      const threadId = this._activeThreadId();
      if (this.convexService.isAuthenticated() && threadId) {
        this.startWatchingThread(threadId);
      } else {
        this.stopWatchingThread();
        this._messages.set([]);
        this._streamingMessages.set([]);
        this._title.set(null);
        this._seededWorkspaceContext.set(null);
        this._messagesLoading.set(false);
      }
    });

    effect(() => {
      if (this.convexService.isAuthenticated()) {
        this.startWatchingThreadList();
        this.startWatchingUsage();
      } else {
        this.stopWatchingThreadList();
        this.stopWatchingUsage();
        this._rawThreadList.set({ active: [], archived: [] });
        this._optimisticStatus.set(new Map());
        this._usage.set(null);
        this.threadCache.clear();
      }
    });

    // While a thread is open in the panel, the server's `unread` flag legitimately flips to true
    // each time an agent turn finishes (`lastAssistantAt` is stamped after streamText resolves).
    // Auto-fire `markThreadRead` so the server's read state stays consistent. The dot is already
    // suppressed for the active thread in `unreadThreads`, so no optimistic override is needed.
    effect(() => {
      const threadId = this._activeThreadId();
      if (!threadId) return;
      const list = this._rawThreadList();
      const entry =
        list.active.find((t) => t.threadId === threadId) ?? list.archived.find((t) => t.threadId === threadId);
      if (!entry?.unread) return;
      void this.convexService
        .mutation<void>(api.aiChat.markThreadRead, { threadId })
        .catch((error: unknown) => console.error('Failed to auto-mark chat thread read', error));
    });

    // Clear the optimistic prompt as soon as the real persisted user message arrives,
    // so the panel doesn't briefly show two copies during the existing-thread send path.
    // Compare against the stripped (tag-removed) text — the persisted first message of a
    // thread carries an embedded `<kualia-context>` block that the bubble doesn't display.
    effect(() => {
      const threadId = this._activeThreadId();
      if (!threadId) return;
      const pending = this._pendingPromptByThread().get(threadId);
      if (!pending) return;
      const list = this.messages();
      for (let i = list.length - 1; i >= 0; i--) {
        const m = list[i];
        if (m.message?.role !== 'user') continue;
        const visible = stripKualiaAttachmentBodyTags(
          stripKualiaAttachmentsTag(stripKualiaContextTag(m.text ?? ''))
        ).trim();
        if (visible === pending) {
          this.clearPendingOptimistic(threadId);
        }
        break;
      }
    });

    // Once the persisted first user message arrives, the seed is redundant — the derived
    // `workspaceContext` reads from history. Clear it so memory doesn't accumulate.
    effect(() => {
      const list = this.messages();
      for (const m of list) {
        if (m.message?.role !== 'user') continue;
        if (this._seededWorkspaceContext() !== null) {
          this._seededWorkspaceContext.set(null);
        }
        return;
      }
    });

    // Drive the displayed workspace context. When messages give a definitive answer (a user
    // message is loaded), apply it and cache it for instant restore on later re-selection. While
    // messages haven't arrived yet (cache miss in progress), only the seed can move the value;
    // otherwise we hold whatever was last displayed so the chip doesn't flash out then back in.
    effect(() => {
      const fromMessages = this._workspaceContextFromMessages();
      if (fromMessages !== undefined) {
        this._displayedWorkspaceContext.set(fromMessages);
        const id = this._activeThreadId();
        if (id) {
          const cached = this.threadCache.get(id);
          if (cached && cached.workspaceContext !== fromMessages) {
            this.threadCache.set(id, { ...cached, workspaceContext: fromMessages });
          }
        }
        return;
      }
      const seeded = this._seededWorkspaceContext();
      if (seeded) this._displayedWorkspaceContext.set(seeded);
    });

    this.destroyRef.onDestroy(() => {
      this.stopWatchingThread();
      this.stopWatchingThreadList();
      this.stopWatchingUsage();
      if (this.titleSwapTimer !== null) clearTimeout(this.titleSwapTimer);
    });
  }

  /**
   * Fade the header to a new title. Called by the launcher at the start of a content swap so the
   * header doesn't have to wait for the slower message-list fade to complete before reflecting
   * the chat we're switching to. Sequence: fade out (75ms) → swap text → fade back in.
   */
  setNextTitle(title: string | null): void {
    if (title === this._title()) return;
    if (this.titleSwapTimer !== null) clearTimeout(this.titleSwapTimer);
    this._titleSwapping.set(true);
    this.titleSwapTimer = setTimeout(() => {
      this._title.set(title);
      this._titleSwapping.set(false);
      this.titleSwapTimer = null;
    }, 75);
  }

  /** Open an empty new-chat panel; no thread is created until the user sends. */
  openNewChat(): void {
    this._pendingNewChat.set(true);
    this._activeThreadId.set(null);
    this._error.set(null);
    // The displayed workspace chip is derived from the active thread's history. A new chat has
    // none yet — clear so a stale name from the previously-active chat doesn't bleed through.
    this._displayedWorkspaceContext.set(null);
  }

  /**
   * Make a thread active (visible in the panel).
   *
   * `titleHint` lets the caller (typically the bottom-bar launcher, which already knows each
   * thread's title from `listThreads`) seed the header so it doesn't flash "New chat" while the
   * per-thread watcher boots up.
   */
  selectChat(threadId: string, titleHint: string | null = null): void {
    this._pendingNewChat.set(false);
    this._error.set(null);

    // Seed the displayed signals BEFORE flipping `_activeThreadId`. The effect that swaps
    // watchers fires after — by then the panel is already showing the right content (cached
    // messages + title, or at minimum the title hint), so the cross-fade reveals the correct
    // chat instead of an empty/loading flash.
    const cached = this.threadCache.get(threadId);
    if (cached) {
      this._messages.set(cached.messages);
      this._streamingMessages.set(cached.streamingMessages);
      this._title.set(cached.title);
      // Restore the workspace chip if we've resolved it before — `undefined` means we never did,
      // so leave the displayed value alone (the watcher will update it shortly).
      if (cached.workspaceContext !== undefined) {
        this._displayedWorkspaceContext.set(cached.workspaceContext);
      }
      this._messagesLoading.set(false);
    } else {
      this._messages.set([]);
      this._streamingMessages.set([]);
      this._title.set(titleHint);
      this.threadCache.set(threadId, {
        messages: [],
        streamingMessages: [],
        title: titleHint,
      });
      // No cached messages: hide the empty list and fade it in once the watcher delivers.
      // Deliberately NOT clearing `_displayedWorkspaceContext` — keep the previously-shown chip
      // visible until the watcher resolves, otherwise the workspace card flashes away and back.
      this._messagesLoading.set(true);
    }

    this._activeThreadId.set(threadId);
    this.markThreadReadOptimistic(threadId);
  }

  /** Update the typed text on the currently active draft slot. No-op when the panel is closed. */
  setDraftText(text: string): void {
    const key = this.activeDraftKey();
    if (!key) return;
    this._drafts.update((map) => {
      const existing = map.get(key) ?? EMPTY_DRAFT;
      if (existing.text === text) return map;
      const next = new Map(map);
      next.set(key, { text, attachments: existing.attachments });
      return next;
    });
  }

  /**
   * Append a chosen attachment to a draft. Takes an explicit `key` (rather than reading the active
   * key) so that an upload that resolves after the user has switched chats still lands in the
   * draft of the chat the user originally attached it to.
   */
  addDraftAttachment(key: string, attachment: ChatDraftAttachment): void {
    this._drafts.update((map) => {
      const existing = map.get(key) ?? EMPTY_DRAFT;
      const next = new Map(map);
      next.set(key, { text: existing.text, attachments: [...existing.attachments, attachment] });
      return next;
    });
  }

  /** Patch a single draft attachment (typically the upload lifecycle: uploading → ready/error). */
  updateDraftAttachment(key: string, id: string, patch: Partial<ChatDraftAttachment>): void {
    this._drafts.update((map) => {
      const existing = map.get(key);
      if (!existing) return map;
      const next = new Map(map);
      next.set(key, {
        text: existing.text,
        attachments: existing.attachments.map((a) => (a.id === id ? { ...a, ...patch } : a)),
      });
      return next;
    });
  }

  /** Remove a single attachment chip from a draft (user clicked the × on the chip). */
  removeDraftAttachment(key: string, id: string): void {
    this._drafts.update((map) => {
      const existing = map.get(key);
      if (!existing) return map;
      const next = new Map(map);
      next.set(key, { text: existing.text, attachments: existing.attachments.filter((a) => a.id !== id) });
      return next;
    });
  }

  /** Drop a draft entirely — called on send and on chat delete. */
  clearDraft(key: string): void {
    this._drafts.update((map) => {
      if (!map.has(key)) return map;
      const next = new Map(map);
      next.delete(key);
      return next;
    });
  }

  /** Hide the panel; taskbar entries remain. Expanded preference is preserved for the next reopen. */
  minimize(): void {
    this._pendingNewChat.set(false);
    this._activeThreadId.set(null);
  }

  expand(): void {
    this._expanded.set(true);
  }

  collapse(): void {
    this._expanded.set(false);
  }

  toggleExpanded(): void {
    this._expanded.update((v) => !v);
  }

  private loadExpandedFromStorage(): boolean {
    try {
      return localStorage.getItem(this.EXPANDED_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  }

  private saveExpandedToStorage(expanded: boolean): void {
    try {
      localStorage.setItem(this.EXPANDED_STORAGE_KEY, expanded ? 'true' : 'false');
    } catch (error) {
      console.warn('Failed to save AI chat expanded state to localStorage:', error);
    }
  }

  setChatPanelTargetRect(rect: { top: number; left: number; width: number; height: number } | null): void {
    this._chatPanelTargetRect.set(rect);
  }

  /**
   * Permanently delete a thread on the server. Closes the panel if it was active and removes the
   * thread from both active and archived lists optimistically; the server mutation then prunes
   * messages/runs/streams.
   */
  async deleteChat(threadId: string): Promise<void> {
    this.reporting.capture(TrackingEvent.AI_CHAT_THREAD_DELETED, { thread_id: threadId });
    if (this._activeThreadId() === threadId) {
      this.minimize();
    }
    const previous = this._rawThreadList();
    this._rawThreadList.set({
      active: previous.active.filter((t) => t.threadId !== threadId),
      archived: previous.archived.filter((t) => t.threadId !== threadId),
    });
    this.clearOptimisticStatus(threadId);
    this.clearDraft(threadId);
    try {
      await this.convexService.mutation<void>(api.aiChat.deleteThread, { threadId });
    } catch (error: unknown) {
      console.error('Failed to delete chat thread', error);
      this._rawThreadList.set(previous);
      this._error.set('Could not delete chat. Please try again.');
    }
  }

  /** Archive a thread (removes from taskbar, adds to history). Updates the bar optimistically. */
  async closeChat(threadId: string): Promise<void> {
    this.reporting.capture(TrackingEvent.AI_CHAT_THREAD_ARCHIVED, { thread_id: threadId });
    if (this._activeThreadId() === threadId) {
      this.minimize();
    }
    this.setOptimisticStatus(threadId, 'archived');
    try {
      await this.convexService.mutation<void>(api.aiChat.setThreadStatus, {
        threadId,
        status: 'archived',
      });
    } catch (error: unknown) {
      console.error('Failed to archive chat thread', error);
      this.clearOptimisticStatus(threadId);
      this._error.set('Could not close chat. Please try again.');
    }
  }

  /**
   * Restore an archived thread to the taskbar and select it. Updates the bar and opens the panel
   * optimistically using `titleHint` as the header text; the messages list fades in once the
   * watcher delivers them.
   */
  async reopenFromHistory(threadId: string, titleHint: string | null = null): Promise<void> {
    this.setOptimisticStatus(threadId, 'active');
    this.selectChat(threadId, titleHint);
    try {
      await this.convexService.mutation<void>(api.aiChat.setThreadStatus, {
        threadId,
        status: 'active',
      });
    } catch (error: unknown) {
      console.error('Failed to reopen chat thread', error);
      this.clearOptimisticStatus(threadId);
      this.minimize();
      this._error.set('Could not reopen chat. Please try again.');
    }
  }

  /**
   * Abort the in-flight streamed response on the active thread. Marks all streaming
   * messages as aborted server-side; the running action shuts down on its next
   * delta write, which clears `isSending` shortly after. Safe to call when nothing
   * is streaming — the mutation just no-ops.
   */
  async stopMessage(): Promise<void> {
    const threadId = this._activeThreadId();
    if (!threadId) return;
    try {
      await this.convexService.mutation<void>(api.aiChat.stopStream, { threadId });
    } catch (error: unknown) {
      console.error('Failed to stop chat response', error);
      this._error.set('Could not stop response. Please try again.');
    }
  }

  /**
   * Upload a single file to Convex storage so the chat backend can read it as a multimodal
   * attachment. Resolves with the metadata the chat action expects (`storageId`, `mediaType`,
   * `filename`); the backend deletes the storage blob ~24h after the message is sent.
   *
   * After the file lands in `_storage`, this also calls `recordChatAttachment` to register
   * ownership — without that row, `sendMessage` will reject the storageId on the next turn.
   */
  async uploadChatAttachment(file: File): Promise<ChatAttachment> {
    if (file.size > MAX_CHAT_ATTACHMENT_BYTES) {
      throw new Error(`File exceeds the ${Math.round(MAX_CHAT_ATTACHMENT_BYTES / (1024 * 1024))} MB size limit.`);
    }
    const uploadUrl = await this.convexService.mutation<string>(api.storage.generateChatAttachmentUploadUrl, {});
    const mediaType = file.type !== '' ? file.type : 'application/octet-stream';
    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 'Content-Type': mediaType },
      body: file,
    });
    if (!response.ok) {
      throw new Error(`Upload failed: ${response.statusText}`);
    }
    const { storageId } = (await response.json()) as { storageId: Id<'_storage'> };
    await this.convexService.mutation<void>(api.storage.recordChatAttachment, {
      storageId,
      mediaType,
      size: file.size,
      filename: file.name,
    });
    return { storageId, mediaType, filename: file.name };
  }

  async sendMessage(prompt: string, attachments: ChatAttachment[] = []): Promise<void> {
    const trimmed = prompt.trim();
    if (!trimmed && attachments.length === 0) return;

    const isPending = this._pendingNewChat();
    const activeId = this._activeThreadId();
    if (!isPending && !activeId) return;

    // Surface the cap before we even attempt the action — keeps the user from
    // seeing a generic "Message failed" toast when the server-side guard fires.
    if (this.limitReached()) {
      this._error.set('Monthly AI usage limit reached. Resets on the 1st.');
      return;
    }

    this.reporting.capture(TrackingEvent.AI_CHAT_MESSAGE_SENT, {
      is_first_message: isPending,
      prompt_chars: trimmed.length,
    });

    const wsId = this.workspaceService.workspaceId();
    const wsName = this.workspaceService.workspace()?.name;
    const seededContext: ThreadWorkspaceContext | null =
      wsId && wsName ? { workspaceId: wsId as Id<'workspace'>, workspaceName: wsName } : null;

    // On the first send for a thread, prepend a `<kualia-context>` tag carrying the active
    // workspace metadata. The agent (and the UI) read the tag from message history later turns —
    // it's the single source of truth for thread workspace context, no separate persistence.
    // When attachments are present, also prepend a `<kualia-attachments>` tag so the persisted
    // user message carries the file names — the panel parses them out to render chips above the
    // bubble (image parts on the AI SDK don't preserve filenames on their own).
    const contextTag =
      isPending && seededContext
        ? `${encodeKualiaContextTag({
            workspaceId: seededContext.workspaceId,
            workspaceName: seededContext.workspaceName,
          })}\n\n`
        : '';
    const attachmentsTag =
      attachments.length > 0
        ? `${encodeKualiaAttachmentsTag(attachments.map((a) => ({ filename: a.filename, mediaType: a.mediaType })))}\n\n`
        : '';
    const promptToSend = `${contextTag}${attachmentsTag}${trimmed}`;

    this._error.set(null);
    // Seed optimistic state under the temporary new-chat key; rekeyed to the real threadId once
    // `createThread` lands (so the dataset of in-flight sends always uses the canonical thread key).
    const initialKey = isPending ? NEW_CHAT_DRAFT_KEY : activeId!;
    this.setPendingOptimistic(initialKey, trimmed, attachments);
    // Show the chip alongside the optimistic user bubble — without this it only appears once the
    // persisted first user message arrives (and the watcher delivers it), which lags the send.
    if (isPending && seededContext) {
      this._seededWorkspaceContext.set(seededContext);
    }

    // On the new-chat path, create the thread up front (cheap mutation) and bind the panel to it
    // *before* invoking the streaming action. This is what gets the assistant reply to render
    // token-by-token: the message/stream/threadInfo watchers start the moment selectChat flips
    // `_activeThreadId`, so by the time `sendMessage` writes its first delta, the panel is
    // already subscribed. (When the action used to create the thread itself, watchers didn't
    // subscribe until after the action returned — the stream was already drained, so the reply
    // materialized all at once instead of streaming.)
    let threadId: string;
    if (isPending) {
      try {
        const created = await this.convexService.mutation<{ threadId: string }>(api.aiChat.createThread, {});
        threadId = created.threadId;
      } catch (error: unknown) {
        console.error('Failed to create chat thread', error);
        this._error.set('Message failed to send. Please try again.');
        this.clearPendingOptimistic(initialKey);
        this._seededWorkspaceContext.set(null);
        return;
      }
      // Move the optimistic state from the new-chat key to the real threadId so the `isSending`
      // computed (which reads via `activeDraftKey`) tracks the right slot once the panel rebinds.
      this.rekeyPendingOptimistic(initialKey, threadId);
      // Seed an empty cache entry so `selectChat` takes the no-loading branch — otherwise the
      // messages list briefly fades to empty while the watchers warm up, which feels like a chat
      // switch even though the user is still on the same conversation.
      this.threadCache.set(threadId, {
        messages: [],
        streamingMessages: [],
        title: null,
      });
      this.selectChat(threadId);
    } else {
      threadId = activeId!;
    }

    try {
      await this.convexService.action<{ threadId: string }>(api.aiChat.sendMessage, {
        threadId,
        prompt: promptToSend,
        ...(attachments.length > 0 ? { attachments } : {}),
      });
    } catch (error: unknown) {
      console.error('Failed to send chat message', error);
      this._error.set('Message failed to send. Please try again.');
      this.clearPendingOptimistic(threadId);
      if (isPending) {
        // Roll back to the pending-new-chat panel and discard the empty thread we just created.
        // Without this, a failed first send leaves the user attached to an existing-but-empty
        // thread, and a retry would skip the workspace-context tag (since `isPending` is now
        // false) — leaving the agent without workspace context for the rest of the conversation.
        this._seededWorkspaceContext.set(null);
        this._activeThreadId.set(null);
        this._pendingNewChat.set(true);
        this.threadCache.delete(threadId);
        void this.convexService.mutation(api.aiChat.deleteThread, { threadId }).catch(() => undefined);
      }
    } finally {
      this.removePendingSend(threadId);
    }
  }

  /** Mark a key as having an in-flight send and seed its optimistic prompt + attachments. */
  private setPendingOptimistic(key: string, prompt: string, attachments: readonly ChatAttachment[]): void {
    const sends = new Set(this._pendingSends());
    sends.add(key);
    this._pendingSends.set(sends);

    const prompts = new Map(this._pendingPromptByThread());
    prompts.set(key, prompt);
    this._pendingPromptByThread.set(prompts);

    const atts = new Map(this._pendingAttachmentsByThread());
    atts.set(key, attachments);
    this._pendingAttachmentsByThread.set(atts);
  }

  /** Move optimistic state from one key to another (used when a pending-new-chat resolves to a real threadId). */
  private rekeyPendingOptimistic(fromKey: string, toKey: string): void {
    if (fromKey === toKey) return;

    const sends = new Set(this._pendingSends());
    if (sends.has(fromKey)) {
      sends.delete(fromKey);
      sends.add(toKey);
      this._pendingSends.set(sends);
    }

    const prompts = new Map(this._pendingPromptByThread());
    const promptValue = prompts.get(fromKey);
    if (promptValue !== undefined) {
      prompts.delete(fromKey);
      prompts.set(toKey, promptValue);
      this._pendingPromptByThread.set(prompts);
    }

    const atts = new Map(this._pendingAttachmentsByThread());
    const attsValue = atts.get(fromKey);
    if (attsValue !== undefined) {
      atts.delete(fromKey);
      atts.set(toKey, attsValue);
      this._pendingAttachmentsByThread.set(atts);
    }
  }

  /** Drop only the optimistic prompt + attachments for a key, leaving the in-flight flag alone. */
  private clearPendingOptimistic(key: string): void {
    const prompts = new Map(this._pendingPromptByThread());
    if (prompts.delete(key)) this._pendingPromptByThread.set(prompts);

    const atts = new Map(this._pendingAttachmentsByThread());
    if (atts.delete(key)) this._pendingAttachmentsByThread.set(atts);
  }

  /** Drop the in-flight send flag for a key (called when the action resolves or fails). */
  private removePendingSend(key: string): void {
    const sends = new Set(this._pendingSends());
    if (sends.delete(key)) this._pendingSends.set(sends);
  }

  private startWatchingThread(threadId: string): void {
    this.stopWatchingThread();
    // No clearing here — `selectChat` already seeded the displayed signals from cache or hint.
    // Watchers below will overwrite them once fresh server data arrives.

    const messageWatcher = this.convexService.watchQuery<ListMessagesResponse>(api.aiChat.listMessages, {
      threadId,
      paginationOpts: { numItems: MESSAGE_PAGE_SIZE, cursor: null },
    });
    this.messagesSubscription = messageWatcher.subscribe((data) => {
      if (data !== undefined) {
        this._messages.set(data.page);
        this.updateThreadCache(threadId, { messages: data.page });
        this._messagesLoading.set(false);
      }
    });

    const streamWatcher = this.convexService.watchQuery<StreamingMessages>(api.aiChat.streamMessages, {
      threadId,
    });
    this.streamSubscription = streamWatcher.subscribe((data) => {
      if (data !== undefined) {
        this._streamingMessages.set(data);
        this.updateThreadCache(threadId, { streamingMessages: data });
      }
    });

    const threadInfoWatcher = this.convexService.watchQuery<ThreadInfo>(api.aiChat.getThreadInfo, {
      threadId,
    });
    this.threadInfoSubscription = threadInfoWatcher.subscribe((data) => {
      if (data !== undefined) {
        const title = data?.title ?? null;
        this._title.set(title);
        this.updateThreadCache(threadId, { title });
      }
    });
  }

  private updateThreadCache(threadId: string, partial: Partial<ThreadCacheEntry>): void {
    const existing = this.threadCache.get(threadId) ?? {
      messages: [],
      streamingMessages: [],
      title: null,
    };
    this.threadCache.set(threadId, { ...existing, ...partial });
  }

  private stopWatchingThread(): void {
    if (this.messagesSubscription) {
      this.messagesSubscription();
      this.messagesSubscription = undefined;
    }
    if (this.streamSubscription) {
      this.streamSubscription();
      this.streamSubscription = undefined;
    }
    if (this.threadInfoSubscription) {
      this.threadInfoSubscription();
      this.threadInfoSubscription = undefined;
    }
  }

  private startWatchingThreadList(): void {
    this.stopWatchingThreadList();
    const watcher = this.convexService.watchQuery<ThreadList>(api.aiChat.listThreads, {});
    this.threadListSubscription = watcher.subscribe((data) => {
      if (data === undefined) return;
      this._rawThreadList.set(data);
      this.reconcileOptimisticStatus(data);
      this.reconcileOptimisticRead(data);
    });
  }

  /** Drop optimistic status overrides whose state the server has now confirmed. */
  private reconcileOptimisticStatus(data: ThreadList): void {
    const overrides = this._optimisticStatus();
    if (overrides.size === 0) return;
    const activeIds = new Set(data.active.map((t) => t.threadId));
    const archivedIds = new Set(data.archived.map((t) => t.threadId));
    const next = new Map(overrides);
    let changed = false;
    for (const [id, status] of overrides) {
      const matches = (status === 'active' && activeIds.has(id)) || (status === 'archived' && archivedIds.has(id));
      if (matches) {
        next.delete(id);
        changed = true;
      }
    }
    if (changed) this._optimisticStatus.set(next);
  }

  /** Drop optimistic-read overrides for threads the server now reports as read. */
  private reconcileOptimisticRead(data: ThreadList): void {
    const overrides = this._optimisticRead();
    if (overrides.size === 0) return;
    const next = new Set(overrides);
    let changed = false;
    const stillUnread = new Set<string>();
    for (const t of data.active) if (t.unread) stillUnread.add(t.threadId);
    for (const t of data.archived) if (t.unread) stillUnread.add(t.threadId);
    for (const id of overrides) {
      if (!stillUnread.has(id)) {
        next.delete(id);
        changed = true;
      }
    }
    if (changed) this._optimisticRead.set(next);
  }

  /**
   * Optimistically clear the unread dot for `threadId` and fire `markThreadRead` so the server
   * stamps `lastReadAt`. The override is purely a cover for the gap between the click and the
   * server roundtrip — drop it as soon as the mutation resolves so a *subsequent* assistant turn
   * (which legitimately re-marks the thread unread) can re-show the dot. If we held the override
   * until the watcher reported `unread: false`, a fast follow-up turn would keep the dot suppressed
   * forever — that was the bug where minimizing while in-flight ate the would-be unread signal.
   */
  private markThreadReadOptimistic(threadId: string): void {
    const current = this._optimisticRead();
    if (!current.has(threadId)) {
      const next = new Set(current);
      next.add(threadId);
      this._optimisticRead.set(next);
    }
    void this.convexService
      .mutation<void>(api.aiChat.markThreadRead, { threadId })
      .then(() => this.dropOptimisticRead(threadId))
      .catch((error: unknown) => {
        console.error('Failed to mark chat thread read', error);
        this.dropOptimisticRead(threadId);
      });
  }

  private dropOptimisticRead(threadId: string): void {
    const current = this._optimisticRead();
    if (!current.has(threadId)) return;
    const next = new Set(current);
    next.delete(threadId);
    this._optimisticRead.set(next);
  }

  private setOptimisticStatus(threadId: string, status: 'active' | 'archived'): void {
    const next = new Map(this._optimisticStatus());
    next.set(threadId, status);
    this._optimisticStatus.set(next);
  }

  private clearOptimisticStatus(threadId: string): void {
    const current = this._optimisticStatus();
    if (!current.has(threadId)) return;
    const next = new Map(current);
    next.delete(threadId);
    this._optimisticStatus.set(next);
  }

  private stopWatchingThreadList(): void {
    if (this.threadListSubscription) {
      this.threadListSubscription();
      this.threadListSubscription = undefined;
    }
  }

  private startWatchingUsage(): void {
    this.stopWatchingUsage();
    const watcher = this.convexService.watchQuery<UsageSummary>(api.aiChat.getCurrentUsage, {});
    this.usageSubscription = watcher.subscribe((data) => {
      if (data !== undefined) this._usage.set(data);
    });
  }

  private stopWatchingUsage(): void {
    if (this.usageSubscription) {
      this.usageSubscription();
      this.usageSubscription = undefined;
    }
  }
}
