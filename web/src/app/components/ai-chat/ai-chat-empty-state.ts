import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NucleoIcon, nucleoPaperclip as Paperclip } from '@kualia/icons';
import { AiChatService } from '../../services/ai-chat.service';

interface Suggestion {
  label: string;
  prompt: string;
}

/**
 * Shown inside the chat panel when the active conversation has no turns yet (a fresh new-chat).
 * Each suggestion button pre-fills its prompt and sends it immediately via the chat service —
 * no separate "edit then send" step. Prompts are intentionally specific so they exercise the
 * agent's reporting and reasoning rather than asking things the Reports page already covers.
 */
@Component({
  selector: 'app-ai-chat-empty-state',
  imports: [NucleoIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto flex h-full w-full max-w-sm flex-col justify-center px-1 py-6">
      <div class="mb-4">
        <h2 class="text-foreground text-sm font-semibold">How can I help?</h2>
        <p class="text-muted-foreground text-xs">Ask anything, or try one of these.</p>
      </div>

      <div class="flex flex-wrap gap-1.5">
        @for (s of suggestions; track s.label) {
          <button
            type="button"
            class="border-border bg-popover hover:bg-accent focus-visible:ring-ring text-foreground rounded-full border px-3 py-1.5 text-xs transition-colors focus:outline-none focus-visible:ring-2"
            (click)="run(s.prompt)"
          >
            {{ s.label }}
          </button>
        }
      </div>

      <p class="text-muted-foreground mt-5 flex items-start gap-1.5 text-[11px] leading-snug">
        <nucleo-icon [icon]="Paperclip" [size]="11" class="mt-0.5 shrink-0" />
        <span>Tip: attach a CSV, PDF, or image of a statement and I'll import the transactions for you.</span>
      </p>
    </div>
  `,
  host: {
    class: 'flex h-full w-full',
  },
})
export class AiChatEmptyStateComponent {
  private readonly aiChat = inject(AiChatService);

  protected readonly Paperclip = Paperclip;

  protected readonly suggestions: readonly Suggestion[] = [
    {
      label: 'Biggest merchant shifts recently',
      prompt:
        'Compare my top 5 merchants by spend over the last 30 days against the 30 days before that. For each, show both totals, the dollar change, and the percent change. Call out anything that grew or shrank by more than 25%, and ignore any merchant I only transacted with in one of the two windows.',
    },
    {
      label: 'Where am I drifting over budget?',
      prompt:
        'Look at the past 3 months of spending against my envelope budgets. Which categories have I overspent in two or more of those months? For each, suggest a realistic adjusted monthly target based on my actual average, and explain why.',
    },
    {
      label: 'Savings rate trend',
      prompt:
        'For the last 6 months, compute my monthly savings rate (income minus spending, divided by income). Show the trend, flag any months that are clear outliers, and suggest one specific category to focus on if I want to push the rate higher.',
    },
    {
      label: 'Explain envelope budgeting',
      prompt:
        "I'm new to envelope budgeting. Explain the core idea in plain language, how it differs from a traditional budget, the typical month-to-month workflow, and how I should set up my first envelopes in Kualia given how I'm currently spending.",
    },
  ];

  protected run(prompt: string): void {
    void this.aiChat.sendMessage(prompt);
  }
}
