import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { HlmCommandImports } from '../index';

@Component({
  imports: [HlmCommandImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-command>
      <hlm-command-input class="h-12" placeholder="Search" />
    </hlm-command>
  `,
})
class CommandInputHostComponent {}

describe('HlmCommandInput', () => {
  function createHost(): ComponentFixture<CommandInputHostComponent> {
    TestBed.configureTestingModule({
      imports: [CommandInputHostComponent],
    });

    const fixture = TestBed.createComponent(CommandInputHostComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('applies caller classes to the rendered input group', () => {
    const fixture = createHost();
    const inputGroup = fixture.nativeElement.querySelector('[data-slot="input-group"]') as HTMLElement | null;

    expect(inputGroup).not.toBeNull();
    expect(inputGroup?.className).toContain('h-12');
    expect(inputGroup?.className).not.toContain('h-8');
  });
});
