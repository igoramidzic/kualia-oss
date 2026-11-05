import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { HlmComboboxImports } from '../index';

@Component({
  imports: [HlmComboboxImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-combobox value="one">
      <hlm-combobox-item value="one">One</hlm-combobox-item>
    </hlm-combobox>
  `,
})
class ComboboxItemHostComponent {}

describe('HlmComboboxItem', () => {
  function createHost(): ComponentFixture<ComboboxItemHostComponent> {
    TestBed.configureTestingModule({
      imports: [ComboboxItemHostComponent],
    });

    const fixture = TestBed.createComponent(ComboboxItemHostComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('reserves selected-check space on the left, not the right', () => {
    const fixture = createHost();
    const item = fixture.nativeElement.querySelector('[data-slot="combobox-item"]') as HTMLElement | null;

    expect(item?.className).toContain('ps-8');
    expect(item?.className).toContain('pe-2');
    expect(item?.className).not.toContain('pe-8');
  });
});
