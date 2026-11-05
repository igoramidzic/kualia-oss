import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { HlmSelectImports } from '../index';

@Component({
  imports: [HlmSelectImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-select class="inline-block" [value]="frequency" [itemToString]="frequencyToString">
      <hlm-select-trigger
        size="sm"
        class="hover:bg-accent hover:text-accent-foreground h-8 border-transparent bg-transparent px-1 py-0 text-xs shadow-none focus-visible:border-transparent focus-visible:ring-0"
      >
        <hlm-select-value />
      </hlm-select-trigger>
      <hlm-select-content>
        <hlm-select-item value="monthly">Month</hlm-select-item>
      </hlm-select-content>
    </hlm-select>
  `,
})
class SelectHostComponent {
  readonly frequency = 'monthly';
  readonly frequencyToString = (value: string): string => (value === 'monthly' ? 'month' : value);
}

describe('HlmSelect', () => {
  function createHost(): ComponentFixture<SelectHostComponent> {
    TestBed.configureTestingModule({
      imports: [SelectHostComponent],
    });

    const fixture = TestBed.createComponent(SelectHostComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('keeps compact sizing on the trigger and renders the mapped select value', () => {
    const fixture = createHost();
    const select = fixture.nativeElement.querySelector('hlm-select') as HTMLElement | null;
    const trigger = fixture.nativeElement.querySelector('[data-slot="select-trigger"]') as HTMLElement | null;
    const value = fixture.nativeElement.querySelector('[data-slot="select-value"]') as HTMLElement | null;

    expect(select).not.toBeNull();
    expect(select?.classList.contains('inline-block')).toBe(true);
    expect(select?.classList.contains('h-8')).toBe(false);
    expect(select?.classList.contains('block')).toBe(false);
    expect(trigger?.classList.contains('h-8')).toBe(true);
    expect(trigger?.classList.contains('focus-visible:ring-0')).toBe(true);
    expect(value?.textContent?.trim()).toBe('month');
  });

  it('applies pointer hover styling to select items', () => {
    const fixture = createHost();
    const item = fixture.nativeElement.querySelector('[data-slot="select-item"]') as HTMLElement | null;

    expect(item).not.toBeNull();
    expect(item?.classList.contains('data-highlighted:bg-accent')).toBe(true);
    expect(item?.classList.contains('hover:bg-accent')).toBe(true);
  });
});
