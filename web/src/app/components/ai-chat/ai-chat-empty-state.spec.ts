import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiChatService } from '../../services/ai-chat.service';
import { AiChatEmptyStateComponent } from './ai-chat-empty-state';

describe('AiChatEmptyStateComponent', () => {
  let fixture: ComponentFixture<AiChatEmptyStateComponent>;
  let sendMessageMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    sendMessageMock = vi.fn().mockResolvedValue(undefined);
    await TestBed.configureTestingModule({
      imports: [AiChatEmptyStateComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: AiChatService, useValue: { sendMessage: sendMessageMock } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AiChatEmptyStateComponent);
    fixture.detectChanges();
  });

  it('renders one button per suggestion', () => {
    const buttons = fixture.nativeElement.querySelectorAll('button');
    expect(buttons.length).toBeGreaterThanOrEqual(4);
  });

  it('mentions importing transactions from a file', () => {
    const text = (fixture.nativeElement.textContent ?? '').toLowerCase();
    expect(text).toContain('csv');
    expect(text).toContain('pdf');
    expect(text).toContain('image');
  });

  it('sends the suggestion prompt when clicked', () => {
    const firstButton = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    firstButton.click();
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    const [prompt] = sendMessageMock.mock.calls[0];
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(20);
  });
});
