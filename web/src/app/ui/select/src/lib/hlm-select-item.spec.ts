import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { HlmSelectImports } from '../index';

@Component({
  imports: [HlmSelectImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-select value="one">
      <hlm-select-item value="one">One</hlm-select-item>
    </hlm-select>
  `,
})
class SelectItemHostComponent {}

describe('HlmSelectItem', () => {
  function createHost(): ComponentFixture<SelectItemHostComponent> {
    TestBed.configureTestingModule({
      imports: [SelectItemHostComponent],
    });

    const fixture = TestBed.createComponent(SelectItemHostComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('reserves selected-check space on the left, not the right', () => {
    const fixture = createHost();
    const item = fixture.nativeElement.querySelector('[data-slot="select-item"]') as HTMLElement | null;

    expect(item?.className).toContain('ps-8');
    expect(item?.className).toContain('pe-2');
    expect(item?.className).not.toContain('pe-8');
  });
});
