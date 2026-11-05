import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Id } from 'convex/_generated/dataModel';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiChatService, type ChatAttachment } from './ai-chat.service';
import { ConvexService } from './convex.service';
import { WorkspaceService } from './workspace.service';

/** Cast a plain string into the branded `Id<'_storage'>` shape tests need to pass typechecking. */
const storageId = (raw: string) => raw as unknown as Id<'_storage'>;

interface CapturedWatcher {
  query: unknown;
  args: Record<string, unknown>;
  emit: (data: unknown) => void;
}

describe('AiChatService', () => {
  let service: AiChatService;
  let mutationMock: ReturnType<typeof vi.fn>;
  let actionMock: ReturnType<typeof vi.fn>;
  let watchQueryMock: ReturnType<typeof vi.fn>;
  let capturedWatchers: CapturedWatcher[];
  let workspaceSignal: ReturnType<typeof signal<{ _id: string; name: string } | undefined>>;
  let workspaceIdSignal: ReturnType<typeof signal<string | null>>;

  beforeEach(() => {
    // Default: every mutation resolves to `{ threadId: 'thread_new' }`. This lets `createThread`
    // tests work without per-call setup; mutations whose return value the service ignores
    // (setThreadStatus, deleteThread, stopStream) are unaffected — assertions on those check
    // call args, not return values.
    mutationMock = vi.fn().mockResolvedValue({ threadId: 'thread_new' });
    actionMock = vi.fn().mockResolvedValue({ threadId: 'thread_new' });
    capturedWatchers = [];
    watchQueryMock = vi.fn().mockImplementation((query: unknown, args: Record<string, unknown>) => ({
      subscribe: (callback: (data: unknown) => void) => {
        capturedWatchers.push({ query, args, emit: callback });
        return () => undefined;
      },
    }));
    workspaceSignal = signal<{ _id: string; name: string } | undefined>(undefined);
    workspaceIdSignal = signal<string | null>(null);

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        AiChatService,
        {
          provide: ConvexService,
          useValue: {
            isAuthenticated: () => true,
            mutation: mutationMock,
            action: actionMock,
            watchQuery: watchQueryMock,
          },
        },
        {
          provide: WorkspaceService,
          useValue: {
            workspace: workspaceSignal.asReadonly(),
            workspaceId: workspaceIdSignal.asReadonly(),
            userWorkspaceCount: signal<number | null>(null).asReadonly(),
          },
        },
      ],
    });

    service = TestBed.inject(AiChatService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.clearAllMocks();
  });

  it('openNewChat sets pending state without creating a thread', () => {
    expect(service.pendingNewChat()).toBe(false);
    service.openNewChat();
    expect(service.pendingNewChat()).toBe(true);
    expect(service.activeThreadId()).toBeNull();
    expect(mutationMock).not.toHaveBeenCalled();
    expect(actionMock).not.toHaveBeenCalled();
  });

  it('selectChat switches the active thread', () => {
    service.selectChat('thread_a');
    expect(service.activeThreadId()).toBe('thread_a');
    expect(service.pendingNewChat()).toBe(false);
    service.selectChat('thread_b');
    expect(service.activeThreadId()).toBe('thread_b');
  });

  it('minimize clears pending and active state', () => {
    service.openNewChat();
    service.minimize();
    expect(service.pendingNewChat()).toBe(false);
    expect(service.activeThreadId()).toBeNull();

    service.selectChat('thread_a');
    service.minimize();
    expect(service.activeThreadId()).toBeNull();
  });

  it('first message on a pending new chat creates a thread, pivots, and then streams', async () => {
    service.openNewChat();
    await service.sendMessage('hello');

    // Mutation fires before the action so the panel can subscribe to streamMessages before
    // deltas land — without this the assistant reply would materialize all at once.
    expect(mutationMock).toHaveBeenCalled();
    expect(actionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ threadId: 'thread_new', prompt: 'hello' })
    );
    expect(service.activeThreadId()).toBe('thread_new');
    expect(service.pendingNewChat()).toBe(false);
  });

  it('binds the panel to the new thread before invoking the streaming action', async () => {
    // Hold the action open with a deferred promise so we can snapshot state in between the
    // createThread mutation resolving and the action call resolving — that's the window where
    // selectChat must already have fired so the watchers can receive streamed deltas.
    let resolveAction: ((value: { threadId: string }) => void) | undefined;
    const pendingAction = new Promise<{ threadId: string }>((resolve) => {
      resolveAction = resolve;
    });
    actionMock.mockReturnValueOnce(pendingAction);

    service.openNewChat();
    const send = service.sendMessage('hello');

    // Drain microtasks so the awaited createThread mutation settles and selectChat runs.
    await Promise.resolve();
    await Promise.resolve();

    expect(service.activeThreadId()).toBe('thread_new');
    expect(service.pendingNewChat()).toBe(false);
    expect(actionMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ threadId: 'thread_new' }));

    resolveAction?.({ threadId: 'thread_new' });
    await send;
  });

  it('rolls back to pending-new-chat and deletes the empty thread when the first send fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    actionMock.mockRejectedValueOnce(new Error('boom'));

    service.openNewChat();
    await service.sendMessage('hello');

    expect(service.error()).toContain('Message failed');
    expect(service.pendingNewChat()).toBe(true);
    expect(service.activeThreadId()).toBeNull();
    // The empty thread we just created is cleaned up so a retry starts from scratch with the
    // workspace-context tag re-attached.
    expect(mutationMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ threadId: 'thread_new' }));
    consoleSpy.mockRestore();
  });

  it('embeds a kualia-context tag in the first prompt when a workspace is active', async () => {
    workspaceSignal.set({ _id: 'workspace_abc', name: 'Kualia Board' });
    workspaceIdSignal.set('workspace_abc');

    service.openNewChat();
    await service.sendMessage('hello');

    const call = actionMock.mock.calls[0];
    const args = call[1] as { prompt: string };
    expect(args.prompt).toMatch(/^<kualia-context>.*workspace_abc.*Kualia Board.*<\/kualia-context>\n\nhello$/s);
    expect(service.workspaceContext()).toEqual({ workspaceId: 'workspace_abc', workspaceName: 'Kualia Board' });
  });

  it('does not embed the tag on follow-up sends', async () => {
    workspaceSignal.set({ _id: 'workspace_abc', name: 'Kualia Board' });
    workspaceIdSignal.set('workspace_abc');
    service.selectChat('thread_existing');
    await service.sendMessage('follow up');

    expect(actionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ threadId: 'thread_existing', prompt: 'follow up' })
    );
  });

  it('omits the tag when no workspace is active', async () => {
    service.openNewChat();
    await service.sendMessage('hello');

    expect(actionMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ prompt: 'hello' }));
  });

  it('sendMessage on an active thread passes its id', async () => {
    service.selectChat('thread_existing');
    await service.sendMessage('hi');
    expect(actionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ threadId: 'thread_existing', prompt: 'hi' })
    );
  });

  it('skips empty prompts', async () => {
    service.selectChat('thread_a');
    await service.sendMessage('   ');
    expect(actionMock).not.toHaveBeenCalled();
  });

  it('skips sendMessage when no chat is open', async () => {
    await service.sendMessage('hello');
    expect(actionMock).not.toHaveBeenCalled();
  });

  it('captures errors from the action', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    actionMock.mockRejectedValueOnce(new Error('boom'));
    service.selectChat('thread_a');
    await service.sendMessage('Hi');
    expect(service.error()).toContain('Message failed');
    expect(service.isSending()).toBe(false);
    consoleSpy.mockRestore();
  });

  it('refuses sendMessage once the monthly usage limit is reached', async () => {
    service.selectChat('thread_a');
    TestBed.flushEffects();

    // The two no-arg watchers (`listThreads`, `getCurrentUsage`) register in that order from
    // the auth-gated effect; the second is the usage one.
    const noArgWatchers = capturedWatchers.filter((w) => Object.keys(w.args).length === 0);
    expect(noArgWatchers.length).toBeGreaterThanOrEqual(2);
    const usageWatcher = noArgWatchers[1];
    usageWatcher.emit({ yearMonth: '2026-05', costUsd: 12.5, limitUsd: 10, limitReached: true });
    TestBed.flushEffects();

    expect(service.limitReached()).toBe(true);
    await service.sendMessage('hi');
    expect(actionMock).not.toHaveBeenCalled();
    expect(service.error()).toContain('limit');
  });

  it('closeChat archives the thread and minimizes if active', async () => {
    service.selectChat('thread_a');
    await service.closeChat('thread_a');
    expect(mutationMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ threadId: 'thread_a', status: 'archived' })
    );
    expect(service.activeThreadId()).toBeNull();
  });

  it('closeChat on a non-active thread leaves the active selection alone', async () => {
    service.selectChat('thread_active');
    await service.closeChat('thread_other');
    expect(service.activeThreadId()).toBe('thread_active');
    expect(mutationMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ threadId: 'thread_other', status: 'archived' })
    );
  });

  it('reopenFromHistory restores the thread to active and selects it', async () => {
    await service.reopenFromHistory('thread_old');
    expect(mutationMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ threadId: 'thread_old', status: 'active' })
    );
    expect(service.activeThreadId()).toBe('thread_old');
  });

  it('sets pendingUserPrompt synchronously on send and keeps it until the watcher clears it', async () => {
    let resolveAction: ((value: { threadId: string }) => void) | undefined;
    const pendingAction = new Promise<{ threadId: string }>((resolve) => {
      resolveAction = resolve;
    });
    actionMock.mockReturnValueOnce(pendingAction);

    service.selectChat('thread_a');
    expect(service.pendingUserPrompt()).toBeNull();

    const send = service.sendMessage('hello there');
    expect(service.pendingUserPrompt()).toBe('hello there');

    resolveAction?.({ threadId: 'thread_a' });
    await send;

    // Still set — only the watcher-based effect clears it when the real message arrives
    expect(service.pendingUserPrompt()).toBe('hello there');
  });

  it('clears pendingUserPrompt early when the persisted user message arrives via the watcher', async () => {
    let resolveAction: ((value: { threadId: string }) => void) | undefined;
    const pendingAction = new Promise<{ threadId: string }>((resolve) => {
      resolveAction = resolve;
    });
    actionMock.mockReturnValueOnce(pendingAction);

    service.selectChat('thread_a');
    TestBed.flushEffects();

    const messagesWatcher = capturedWatchers.find(
      (w) => 'paginationOpts' in w.args && w.args['threadId'] === 'thread_a'
    );
    expect(messagesWatcher).toBeDefined();

    const send = service.sendMessage('hi from user');
    expect(service.pendingUserPrompt()).toBe('hi from user');

    messagesWatcher?.emit({
      page: [
        {
          _id: 'msg_1',
          order: 1,
          stepOrder: 0,
          message: { role: 'user' },
          text: 'hi from user',
        },
      ],
      isDone: true,
      continueCursor: null,
    });
    TestBed.flushEffects();

    expect(service.pendingUserPrompt()).toBeNull();

    resolveAction?.({ threadId: 'thread_a' });
    await send;
  });

  it('stopMessage calls the stopStream mutation for the active thread', async () => {
    service.selectChat('thread_a');
    await service.stopMessage();
    expect(mutationMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ threadId: 'thread_a' }));
  });

  it('stopMessage is a no-op when no thread is active', async () => {
    await service.stopMessage();
    expect(mutationMock).not.toHaveBeenCalled();
  });

  it('clears pendingUserPrompt when the action errors', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    actionMock.mockRejectedValueOnce(new Error('boom'));

    service.selectChat('thread_a');
    await service.sendMessage('failing message');

    expect(service.pendingUserPrompt()).toBeNull();
    consoleSpy.mockRestore();
  });

  it('uploadChatAttachment requests an upload URL, POSTs the file body, then records ownership', async () => {
    mutationMock
      .mockResolvedValueOnce('https://convex.example/upload-url') // generateChatAttachmentUploadUrl
      .mockResolvedValueOnce(undefined); // recordChatAttachment
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      statusText: 'OK',
      json: () => Promise.resolve({ storageId: 'storage_42' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const file = new File(['date,amount\n2026-01-01,-1000'], 'transactions.csv', { type: 'text/csv' });
    const result = await service.uploadChatAttachment(file);

    expect(mutationMock).toHaveBeenCalledTimes(2);
    expect(mutationMock.mock.calls[1][1]).toEqual({
      storageId: 'storage_42',
      mediaType: 'text/csv',
      size: file.size,
      filename: 'transactions.csv',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://convex.example/upload-url',
      expect.objectContaining({
        method: 'POST',
        body: file,
        headers: expect.objectContaining({ 'Content-Type': 'text/csv' }),
      })
    );
    expect(result).toEqual({ storageId: 'storage_42', mediaType: 'text/csv', filename: 'transactions.csv' });

    vi.unstubAllGlobals();
  });

  it('uploadChatAttachment falls back to application/octet-stream when the file has no MIME type', async () => {
    mutationMock.mockResolvedValueOnce('https://convex.example/upload-url').mockResolvedValueOnce(undefined);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      statusText: 'OK',
      json: () => Promise.resolve({ storageId: 'storage_99' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const file = new File(['x'], 'nameless.bin', { type: '' });
    const result = await service.uploadChatAttachment(file);

    expect(result.mediaType).toBe('application/octet-stream');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://convex.example/upload-url',
      expect.objectContaining({ headers: expect.objectContaining({ 'Content-Type': 'application/octet-stream' }) })
    );

    vi.unstubAllGlobals();
  });

  it('uploadChatAttachment surfaces upload failures', async () => {
    mutationMock.mockResolvedValueOnce('https://convex.example/upload-url');
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, statusText: 'Internal Server Error' });
    vi.stubGlobal('fetch', fetchMock);

    const file = new File(['x'], 'a.csv', { type: 'text/csv' });
    await expect(service.uploadChatAttachment(file)).rejects.toThrow(/Upload failed/);

    vi.unstubAllGlobals();
  });

  it('uploadChatAttachment rejects oversized files before requesting an upload URL', async () => {
    const oversizedSize = 11 * 1024 * 1024;
    const file = new File([new Uint8Array(oversizedSize)], 'big.bin', { type: 'application/octet-stream' });

    await expect(service.uploadChatAttachment(file)).rejects.toThrow(/size limit/);
    expect(mutationMock).not.toHaveBeenCalled();
  });

  it('sendMessage forwards attachments to the chat action and embeds the attachments tag', async () => {
    service.selectChat('thread_a');
    const attachments: ChatAttachment[] = [
      { storageId: storageId('storage_1'), mediaType: 'text/csv', filename: 'a.csv' },
      { storageId: storageId('storage_2'), mediaType: 'application/pdf', filename: 'b.pdf' },
    ];
    await service.sendMessage('import these', attachments);

    expect(actionMock).toHaveBeenCalledTimes(1);
    const args = actionMock.mock.calls[0][1] as { threadId: string; prompt: string; attachments: ChatAttachment[] };
    expect(args.threadId).toBe('thread_a');
    expect(args.attachments).toEqual(attachments);
    // The persisted prompt carries a `<kualia-attachments>` tag listing each filename + mediaType,
    // followed by a blank line and the user's typed text.
    expect(args.prompt).toMatch(/^<kualia-attachments>.*a\.csv.*b\.pdf.*<\/kualia-attachments>\n\nimport these$/s);
  });

  it('sendMessage omits the attachments field entirely when none are provided', async () => {
    service.selectChat('thread_a');
    await service.sendMessage('plain text turn');

    const call = actionMock.mock.calls[0];
    const args = call[1] as Record<string, unknown>;
    expect(args).not.toHaveProperty('attachments');
  });

  it('sendMessage allows an empty prompt when attachments are present', async () => {
    service.selectChat('thread_a');
    const attachments: ChatAttachment[] = [
      { storageId: storageId('storage_1'), mediaType: 'text/csv', filename: 'a.csv' },
    ];
    await service.sendMessage('   ', attachments);

    expect(actionMock).toHaveBeenCalledTimes(1);
    expect(actionMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ attachments }));
  });

  it('suppresses the unread dot for the active thread and auto-fires markThreadRead', async () => {
    service.selectChat('thread_a');
    TestBed.flushEffects();

    // The two no-arg watchers register from the auth-gated effect in this order:
    // listThreads (index 0), getCurrentUsage (index 1).
    const noArgWatchers = capturedWatchers.filter((w) => Object.keys(w.args).length === 0);
    expect(noArgWatchers.length).toBeGreaterThanOrEqual(1);
    const listWatcher = noArgWatchers[0];

    // Wait for any in-flight `markThreadRead` mutation from `selectChat` to settle so the
    // baseline call count is stable before we assert the auto-effect fires another one.
    await Promise.resolve();
    await Promise.resolve();

    const markReadCallsBefore = mutationMock.mock.calls.filter(
      (call) => (call[1] as { threadId?: string })?.threadId === 'thread_a'
    ).length;

    listWatcher.emit({
      active: [{ threadId: 'thread_a', title: 'A', lastUpdatedAt: 1, unread: true, status: 'active' }],
      archived: [{ threadId: 'thread_b', title: 'B', lastUpdatedAt: 0, unread: true, status: 'archived' }],
    });
    TestBed.flushEffects();

    // Active thread is excluded from the dot set; non-active unread thread still shows.
    expect(service.unreadThreads().has('thread_a')).toBe(false);
    expect(service.unreadThreads().has('thread_b')).toBe(true);

    // The auto-mark-read effect fired at least one additional markThreadRead for thread_a
    // beyond the baseline.
    const markReadCallsAfter = mutationMock.mock.calls.filter(
      (call) => (call[1] as { threadId?: string })?.threadId === 'thread_a'
    ).length;
    expect(markReadCallsAfter).toBeGreaterThan(markReadCallsBefore);
  });
});
