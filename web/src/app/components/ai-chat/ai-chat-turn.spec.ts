import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AiChatTurnComponent } from './ai-chat-turn';
import type { ToolCallView, Turn } from './build-turns';

function baseTurn(overrides: Partial<Turn> = {}): Turn {
  return {
    id: 'turn-1',
    user: { id: 'user-1', role: 'user', text: 'Show my budget' },
    attachments: [],
    assistant: null,
    isThinking: true,
    toolCalls: [],
    currentTool: null,
    durationSeconds: null,
    hadToolError: false,
    ...overrides,
  };
}

const runningTool: ToolCallView = {
  toolCallId: 'tool-1',
  toolName: 'kualia_get_envelope_month_status',
  state: 'running',
  doneLabel: 'Checked envelope status',
  runningLabel: 'Checking envelope status',
};

describe('AiChatTurnComponent', () => {
  function createComponent(turn: Turn): ComponentFixture<AiChatTurnComponent> {
    TestBed.configureTestingModule({
      imports: [AiChatTurnComponent],
    });

    const fixture = TestBed.createComponent(AiChatTurnComponent);
    fixture.componentRef.setInput('turn', turn);
    fixture.detectChanges();
    return fixture;
  }

  it('renders thinking text with a shimmer overlay label', () => {
    const fixture = createComponent(baseTurn());
    const shimmer = fixture.nativeElement.querySelector('.ai-chat-shimmer') as HTMLElement | null;

    expect(shimmer).not.toBeNull();
    expect(shimmer?.textContent?.trim()).toBe('Thinking…');
    expect(shimmer?.getAttribute('data-shimmer-text')).toBe('Thinking…');
  });

  it('renders running tool text with a shimmer overlay label', () => {
    const fixture = createComponent(baseTurn({ currentTool: runningTool }));
    const shimmer = fixture.nativeElement.querySelector(
      '.ai-chat-shimmer[data-shimmer-text="Checking envelope status…"]'
    ) as HTMLElement | null;

    expect(shimmer).not.toBeNull();
    expect(shimmer?.textContent?.trim()).toBe('Checking envelope status…');
  });
});
