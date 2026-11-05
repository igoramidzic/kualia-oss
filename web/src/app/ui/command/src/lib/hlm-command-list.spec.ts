import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { HlmCommandImports } from '../index';

@Component({
  imports: [HlmCommandImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-command>
      <hlm-command-list />
    </hlm-command>
  `,
})
class CommandListHostComponent {}

describe('HlmCommandList', () => {
  function createHost(): ComponentFixture<CommandListHostComponent> {
    TestBed.configureTestingModule({
      imports: [CommandListHostComponent],
    });

    const fixture = TestBed.createComponent(CommandListHostComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('keeps scrollbars visible for global thin scrollbar styling', () => {
    const fixture = createHost();
    const list = fixture.nativeElement.querySelector('[data-slot="command-list"]') as HTMLElement | null;

    expect(list).not.toBeNull();
    expect(list?.className).toContain('overflow-y-auto');
    expect(list?.className).not.toContain('no-scrollbar');
  });
});
