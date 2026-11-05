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
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HlmButton } from '@spartan-ng/helm/button';
import {
  nucleoWarningCircle as AlertCircle,
  nucleoArrowUp as ArrowUp,
  nucleoGrid as LayoutGrid,
  NucleoIcon,
  nucleoPaperclip as Paperclip,
  nucleoStop as Square,
  nucleoClose as X,
} from '@kualia/icons';
import type { ChatDraftAttachment } from '../../services/ai-chat.service';
import { AiChatService, MAX_CHAT_ATTACHMENT_BYTES } from '../../services/ai-chat.service';
import { HlmTooltip } from '../../ui/tooltip/src';

/**
 * Max-height (px) the workspace back-card collapses to when present. Hard-coded to the card's
 * intrinsic height (icon row + py padding + the 2px peek the form pulls up to overlap). If the
 * card's internal padding changes, bump this so the slide-down doesn't clip text mid-animation.
 */
const BACK_CARD_MAX_HEIGHT = 32;

@Component({
  selector: 'app-ai-chat-input',
  imports: [FormsModule, HlmButton, NucleoIcon, HlmTooltip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ai-chat-input.html',
})
export class AiChatInputComponent {
  protected readonly aiChat = inject(AiChatService);

  protected readonly AlertCircle = AlertCircle;
  protected readonly ArrowUp = ArrowUp;
  protected readonly LayoutGrid = LayoutGrid;
  protected readonly Paperclip = Paperclip;
  protected readonly Square = Square;
  protected readonly X = X;

  /** MIME types and file extensions accepted by the attachment picker. */
  protected readonly attachmentAccept = '.csv,.pdf,image/*';

  protected readonly backCardMaxHeight = BACK_CARD_MAX_HEIGHT;

  /** Workspace name shown in the back-card; null hides the card. Resolved by the parent. */
  readonly workspaceName = input<string | null>(null);

  /** True once the user has hit their monthly AI spend cap. Disables input + swaps the back-card. */
  readonly limitReached = input<boolean>(false);

  /** Active draft attachments (uploading/ready/error) sourced from the service. */
  protected readonly pendingAttachments = computed<readonly ChatDraftAttachment[]>(
    () => this.aiChat.currentDraft().attachments
  );

  /** Typed prompt for the active conversation, persisted across panel lifecycle. */
  protected readonly inputValue = computed<string>(() => this.aiChat.currentDraft().text);

  /** True while the user is dragging files over the panel; toggles the drop overlay. */
  protected readonly isDragOver = signal<boolean>(false);
  private dragDepth = 0;

  protected readonly placeholder = computed<string>(() => {
    if (this.limitReached()) return 'Usage limit reached for this month';
    return this.aiChat.activeThreadId() ? 'Reply...' : 'Ask Kualia...';
  });

  private readonly promptInput = viewChild<ElementRef<HTMLTextAreaElement>>('promptInput');
  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');

  constructor() {
    // Re-run autoResize whenever the active draft's text changes externally (chat switch, send,
    // pendingNewChat reset). Keeping height in sync with content avoids a stale tall textarea
    // when switching from a multi-line draft back to an empty one.
    effect(() => {
      this.inputValue();
      queueMicrotask(() => {
        const ta = this.promptInput()?.nativeElement;
        if (ta) this.autoResize(ta);
      });
    });

    // Auto-focus the prompt input on open and on chat switches. Tracks both `activeThreadId` and
    // `pendingNewChat` so the new-chat pivot keeps focus too. requestAnimationFrame waits out the
    // launcher's open transition (the textarea exists from frame 1, so focus succeeds even while
    // the panel is still fading in).
    effect(() => {
      const threadId = this.aiChat.activeThreadId();
      const pendingNew = this.aiChat.pendingNewChat();
      if (!threadId && !pendingNew) return;
      const input = this.promptInput()?.nativeElement;
      if (!input) return;
      requestAnimationFrame(() => input.focus());
    });
  }

  protected canSend(): boolean {
    if (this.aiChat.isStreaming() || this.limitReached()) return false;
    const attachments = this.pendingAttachments();
    if (attachments.some((a) => a.status === 'uploading')) return false;
    const hasReady = attachments.some((a) => a.status === 'ready');
    return this.inputValue().trim().length > 0 || hasReady;
  }

  /** True when a response is generating and the send button should render as a stop button. */
  protected isResponding(): boolean {
    return this.aiChat.isStreaming();
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    if (!this.canSend()) return;
    const draft = this.aiChat.currentDraft();
    const prompt = draft.text;
    const ready = draft.attachments.filter((a) => a.status === 'ready' && a.metadata !== null).map((a) => a.metadata!);
    // Clear the draft *before* sendMessage runs — it can flip the active key (new-chat → real
    // thread id), so we need to drop the slot the user typed into, not whichever one is current
    // by the time the call returns.
    const key = this.aiChat.activeDraftKey();
    if (key) this.aiChat.clearDraft(key);
    const inputEl = this.promptInput()?.nativeElement;
    if (inputEl) inputEl.style.height = '';
    void this.aiChat.sendMessage(prompt, ready);
  }

  /**
   * Auto-grow the prompt textarea up to its CSS max-height; beyond that the textarea scrolls.
   * Toggles `overflow-y` inline so the scrollbar only appears when the content actually exceeds
   * the cap — without this, sub-pixel rounding of `scrollHeight` against the textarea's own
   * layout leaves a phantom scrollbar visible after a few keystrokes (and persists once the
   * field is cleared).
   */
  protected autoResize(target: HTMLTextAreaElement): void {
    target.style.height = 'auto';
    const maxHeight = parseFloat(getComputedStyle(target).maxHeight);
    const desired = target.scrollHeight;
    if (Number.isFinite(maxHeight) && desired > maxHeight) {
      target.style.height = `${maxHeight}px`;
      target.style.overflowY = 'auto';
    } else {
      target.style.height = `${desired}px`;
      target.style.overflowY = '';
    }
  }

  /**
   * Click anywhere inside the input card → focus the textarea. Used so the bottom button row,
   * the attachments strip, and any padding around the textarea all behave as part of one big
   * click target. Skipped when the click landed on an actual interactive element so buttons keep
   * working normally.
   */
  protected onCardMouseDown(event: MouseEvent): void {
    if (!(event.target instanceof HTMLElement)) return;
    if (event.target.closest('button, input, textarea, a, [role="button"]')) return;
    const ta = this.promptInput()?.nativeElement;
    if (!ta) return;
    event.preventDefault();
    ta.focus();
    const len = ta.value.length;
    ta.setSelectionRange(len, len);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      // While the agent is responding, Enter is a no-op — the user must click stop first.
      if (this.aiChat.isStreaming()) return;
      this.onSubmit(event);
    }
  }

  /** Click handler for the send/stop button. Stops the in-flight response when responding,
   *  otherwise submits the typed message. The `type="button"` on the rendered button keeps
   *  the form's submit path off this handler so we don't double-fire. */
  protected onSendOrStop(event: Event): void {
    if (this.aiChat.isStreaming()) {
      event.preventDefault();
      void this.aiChat.stopMessage();
      return;
    }
    this.onSubmit(event);
  }

  /** Open the native file picker; the paperclip button delegates here. */
  protected openFilePicker(): void {
    this.fileInput()?.nativeElement.click();
  }

  /** Handle files chosen from the native picker. Resets the input so the same file can be re-selected. */
  protected onFileInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.addFiles(Array.from(input.files));
    }
    input.value = '';
  }

  protected removeAttachment(id: string): void {
    const key = this.aiChat.activeDraftKey();
    if (!key) return;
    this.aiChat.removeDraftAttachment(key, id);
  }

  /** Push the typed text into the service so it's preserved across chat switches and minimize. */
  protected onTextChange(value: string): void {
    this.aiChat.setDraftText(value);
  }

  /** Drag enter — counter so nested children entering doesn't flicker the overlay off. */
  @HostListener('dragenter', ['$event'])
  protected onDragEnter(event: DragEvent): void {
    if (!this.eventHasFiles(event)) return;
    event.preventDefault();
    this.dragDepth += 1;
    this.isDragOver.set(true);
  }

  @HostListener('dragover', ['$event'])
  protected onDragOver(event: DragEvent): void {
    if (!this.eventHasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  }

  @HostListener('dragleave', ['$event'])
  protected onDragLeave(event: DragEvent): void {
    if (!this.eventHasFiles(event)) return;
    this.dragDepth = Math.max(0, this.dragDepth - 1);
    if (this.dragDepth === 0) this.isDragOver.set(false);
  }

  @HostListener('drop', ['$event'])
  protected onDrop(event: DragEvent): void {
    if (!this.eventHasFiles(event)) return;
    event.preventDefault();
    this.dragDepth = 0;
    this.isDragOver.set(false);
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) this.addFiles(Array.from(files));
  }

  private eventHasFiles(event: DragEvent): boolean {
    const types = event.dataTransfer?.types;
    if (!types) return false;
    for (const type of types) {
      if (type === 'Files') return true;
    }
    return false;
  }

  private addFiles(files: File[]): void {
    // Capture the draft key once, up front. If the user switches chats while an upload is in
    // flight, the resolved metadata still lands on the chat the file was attached to.
    const key = this.aiChat.activeDraftKey();
    if (!key) return;
    for (const file of files) {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const baseEntry: ChatDraftAttachment = {
        id,
        filename: file.name,
        size: file.size,
        mediaType: file.type !== '' ? file.type : 'application/octet-stream',
        status: 'uploading',
        metadata: null,
        error: null,
      };

      // Enforce the per-file cap up front so the user sees an immediate error chip and we don't
      // burn bandwidth on a doomed upload. The server enforces the same limit independently.
      if (file.size > MAX_CHAT_ATTACHMENT_BYTES) {
        const limitMb = Math.round(MAX_CHAT_ATTACHMENT_BYTES / (1024 * 1024));
        this.aiChat.addDraftAttachment(key, {
          ...baseEntry,
          status: 'error',
          error: `File exceeds ${limitMb} MB limit`,
        });
        continue;
      }

      this.aiChat.addDraftAttachment(key, baseEntry);
      void this.aiChat
        .uploadChatAttachment(file)
        .then((metadata) => {
          this.aiChat.updateDraftAttachment(key, id, { status: 'ready', metadata });
        })
        .catch((error: unknown) => {
          console.error('Chat attachment upload failed', error);
          const message = this.extractUploadErrorMessage(error);
          this.aiChat.updateDraftAttachment(key, id, { status: 'error', error: message });
        });
    }
  }

  /**
   * Pull a user-friendly message out of an upload failure. ConvexError surfaces server-side
   * limits ("Too many uploads", "exceeds the 10 MB limit") that the user should see verbatim;
   * everything else falls back to a generic label.
   */
  private extractUploadErrorMessage(error: unknown): string {
    if (typeof error === 'object' && error !== null && 'data' in error) {
      const data = error.data;
      if (typeof data === 'string' && data.length > 0) return data;
    }
    if (error instanceof Error && error.message.length > 0) return error.message;
    return 'Upload failed';
  }
}
