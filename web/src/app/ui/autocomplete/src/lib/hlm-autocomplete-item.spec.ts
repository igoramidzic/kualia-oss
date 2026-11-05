import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { HlmAutocompleteImports } from '../index';

@Component({
  imports: [HlmAutocompleteImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-autocomplete value="one">
      <hlm-autocomplete-item value="one">One</hlm-autocomplete-item>
    </hlm-autocomplete>
  `,
})
class AutocompleteItemHostComponent {}

describe('HlmAutocompleteItem', () => {
  function createHost(): ComponentFixture<AutocompleteItemHostComponent> {
    TestBed.configureTestingModule({
      imports: [AutocompleteItemHostComponent],
    });

    const fixture = TestBed.createComponent(AutocompleteItemHostComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('reserves selected-check space on the left, not the right', () => {
    const fixture = createHost();
    const item = fixture.nativeElement.querySelector('[data-slot="autocomplete-item"]') as HTMLElement | null;

    expect(item?.className).toContain('ps-8');
    expect(item?.className).toContain('pe-2');
    expect(item?.className).not.toContain('pe-8');
  });
});
