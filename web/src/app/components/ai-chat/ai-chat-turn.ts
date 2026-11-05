import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { HlmButton } from '@spartan-ng/helm/button';
import {
  nucleoChevronRight as ChevronRight,
  nucleoCopy as Copy,
  nucleoGrid as LayoutGrid,
  NucleoIcon,
  nucleoPaperclip as Paperclip,
} from '@kualia/icons';
import { toast } from 'ngx-sonner';
import type { ThreadWorkspaceContext } from '../../services/ai-chat.service';
import { MarkdownPipe } from '../../shared/pipes/markdown.pipe';
import { HlmCollapsibleImports } from '../../ui/collapsible/src';
import type { Turn } from './build-turns';
import { splitAssistantText } from './split-transaction-links';
import { TransactionLinkCardComponent } from './transaction-link-card';

@Component({
  selector: 'app-ai-chat-turn',
  imports: [HlmButton, NucleoIcon, HlmCollapsibleImports, MarkdownPipe, TransactionLinkCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ai-chat-turn.html',
  styleUrl: './ai-chat-turn.css',
})
export class AiChatTurnComponent {
  protected readonly ChevronRight = ChevronRight;
  protected readonly Copy = Copy;
  protected readonly LayoutGrid = LayoutGrid;
  protected readonly Paperclip = Paperclip;

  readonly turn = input.required<Turn>();
  readonly isFirst = input<boolean>(false);
  readonly isLast = input<boolean>(false);

  protected readonly assistantSegments = computed(() => {
    const text = this.turn().assistant?.text ?? '';
    return splitAssistantText(text);
  });
  /** Workspace context chip shown under the first user message. Null hides the chip. */
  readonly workspaceContext = input<ThreadWorkspaceContext | null>(null);
  /** Top-level error from the service; rendered as fallback when the last turn has no assistant. */
  readonly error = input<string | null>(null);

  /** Copy an assistant message's plain text and show a confirmation toast. */
  protected async copyAssistantText(text: string): Promise<void> {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch (error: unknown) {
      console.error('Failed to copy message text', error);
      toast.error('Could not copy message');
      return;
    }
    toast.info('Copied message', { description: 'Message copied to clipboard' });
  }
}
