import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { describe, expect, it, vi } from 'vitest';
import { HlmComboboxImports } from '../index';
import { HlmComboboxTrigger } from './hlm-combobox-trigger';

@Component({
  imports: [HlmComboboxImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-combobox>
      <hlm-combobox-trigger [showIcon]="showIcon" [stopPropagation]="stopPropagation">Trigger</hlm-combobox-trigger>
    </hlm-combobox>
  `,
})
class ComboboxTriggerHostComponent {
  showIcon = true;
  stopPropagation = false;
}

describe('HlmComboboxTrigger', () => {
  function createHost(showIcon: boolean, stopPropagation = false): ComponentFixture<ComboboxTriggerHostComponent> {
    TestBed.configureTestingModule({
      imports: [ComboboxTriggerHostComponent],
    });
    const fixture = TestBed.createComponent(ComboboxTriggerHostComponent);
    fixture.componentInstance.showIcon = showIcon;
    fixture.componentInstance.stopPropagation = stopPropagation;
    fixture.detectChanges();
    return fixture;
  }

  it('renders the chevron icon by default', () => {
    const fixture = createHost(true);
    const chevron = fixture.nativeElement.querySelector('button ng-icon') as HTMLElement | null;

    expect(chevron).not.toBeNull();
  });

  it('omits the chevron icon when showIcon is false', () => {
    const fixture = createHost(false);
    const chevron = fixture.nativeElement.querySelector('button ng-icon') as HTMLElement | null;

    expect(chevron).toBeNull();
  });

  it('cancels click propagation when stopPropagation is true', () => {
    const fixture = createHost(true, true);
    const trigger = fixture.debugElement.query(By.directive(HlmComboboxTrigger))
      .componentInstance as HlmComboboxTrigger;
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    const stopPropagation = vi.spyOn(event, 'stopPropagation');
    const preventDefault = vi.spyOn(event, 'preventDefault');

    trigger.onClick(event);

    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(preventDefault).toHaveBeenCalledOnce();
  });
});
