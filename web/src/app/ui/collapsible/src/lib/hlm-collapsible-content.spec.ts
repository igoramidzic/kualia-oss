import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HlmCollapsibleImports } from '../index';

@Component({
  imports: [HlmCollapsibleImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div hlmCollapsible [expanded]="expanded()">
      <button hlmCollapsibleTrigger>Toggle</button>
      <hlm-collapsible-content
        class="grid transition-[grid-template-rows] duration-200 ease-out data-[state=closed]:grid-rows-[0fr] data-[state=open]:grid-rows-[1fr]"
      >
        <div class="overflow-hidden">Content</div>
      </hlm-collapsible-content>
    </div>
  `,
})
class CollapsibleContentHostComponent {
  readonly expanded = signal(true);
}

describe('HlmCollapsibleContent', () => {
  function createHost(): ComponentFixture<CollapsibleContentHostComponent> {
    TestBed.configureTestingModule({
      imports: [CollapsibleContentHostComponent],
    });

    const fixture = TestBed.createComponent(CollapsibleContentHostComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('keeps caller-provided transition classes instead of forcing hidden state', () => {
    const fixture = createHost();
    const content = fixture.nativeElement.querySelector('hlm-collapsible-content') as HTMLElement | null;

    expect(content).not.toBeNull();
    expect(content?.className).toContain('data-[state=closed]:grid-rows-[0fr]');
    expect(content?.className).not.toContain('data-[state=closed]:hidden');
  });

  it('does not add a hidden class when collapsed', () => {
    const fixture = createHost();

    fixture.componentInstance.expanded.set(false);
    fixture.detectChanges();

    const content = fixture.nativeElement.querySelector('hlm-collapsible-content') as HTMLElement | null;

    expect(content).not.toBeNull();
    expect(content?.getAttribute('data-state')).toBe('closed');
    expect(content?.className).not.toContain('hidden');
  });
});
