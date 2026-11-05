import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { NucleoIcon } from './nucleo-icon.component';
import * as artwork from './nucleo-icons';
import { nucleoBudget, nucleoCheck, nucleoLoader, nucleoSidebarLeftClose, nucleoSidebarLeftOpen } from './nucleo-icons';

@Component({
  imports: [NgIcon],
  providers: [provideIcons({ nucleoBudget })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<ng-icon name="nucleoBudget" />',
})
class RegisteredIconHost {}

describe('Nucleo icon rendering', () => {
  it('renders single-tone outlines with the Lucide view box and current text color', async () => {
    const fixture = TestBed.createComponent(NucleoIcon);
    fixture.componentRef.setInput('icon', nucleoBudget);
    fixture.componentRef.setInput('size', 18);
    fixture.detectChanges();
    await fixture.whenStable();
    const element: HTMLElement = fixture.nativeElement;

    expect(element.getAttribute('aria-hidden')).toBe('true');
    expect(element.style.getPropertyValue('--nucleo-icon-size')).toBe('18px');
    expect(element.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(element.querySelector('[fill-opacity], [opacity]')).toBeNull();
    expect(element.querySelector('[stroke="currentColor"]')).not.toBeNull();
  });

  it('updates stateful artwork without leaving the previous SVG behind', async () => {
    const fixture = TestBed.createComponent(NucleoIcon);
    fixture.componentRef.setInput('icon', nucleoSidebarLeftOpen);
    fixture.detectChanges();
    await fixture.whenStable();
    const element: HTMLElement = fixture.nativeElement;
    const before = element.querySelector('svg')?.innerHTML;

    fixture.componentRef.setInput('icon', nucleoSidebarLeftClose);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(element.querySelectorAll('svg')).toHaveLength(1);
    expect(element.querySelector('svg')?.innerHTML).not.toBe(before);
  });

  it.each([
    [14, '14px'],
    ['16', '16px'],
    ['1.25rem', '1.25rem'],
  ])('accepts size %s', (size, expected) => {
    const fixture = TestBed.createComponent(NucleoIcon);
    fixture.componentRef.setInput('icon', nucleoCheck);
    fixture.componentRef.setInput('size', size);
    fixture.detectChanges();

    const element: HTMLElement = fixture.nativeElement;
    expect(element.style.getPropertyValue('--nucleo-icon-size')).toBe(expected);
  });

  it('renders the same artwork through the named registry used by Spartan controls', async () => {
    const fixture = TestBed.createComponent(RegisteredIconHost);
    fixture.detectChanges();
    await fixture.whenStable();
    const element: HTMLElement = fixture.nativeElement;

    expect(element.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(element.querySelector('[fill-opacity], [opacity]')).toBeNull();
    expect(element.querySelector('[stroke="currentColor"]')).not.toBeNull();
  });

  it.each(Object.entries(artwork))('%s contains valid single-tone artwork', (_name, icon) => {
    const svg = new DOMParser().parseFromString(icon, 'image/svg+xml');

    expect(svg.querySelector('parsererror')).toBeNull();
    expect(svg.querySelector('path, circle, rect, polyline, line, polygon, ellipse')).not.toBeNull();
    expect(svg.querySelector('[fill-opacity], [stroke-opacity]')).toBeNull();
    // The outline loader fades its strokes to indicate rotation; filled shading is never used.
    for (const element of svg.querySelectorAll('[opacity]')) {
      expect(element.getAttribute('fill')).toBe('none');
      expect(element.getAttribute('stroke')).toBe('currentColor');
    }
    expect(icon).not.toContain('outline-duo');
  });

  it('uses Lucide loader artwork compatible with the existing spin animation', () => {
    const svg = new DOMParser().parseFromString(nucleoLoader, 'image/svg+xml');
    expect(svg.querySelector('parsererror')).toBeNull();
    expect(svg.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg.querySelector('[stroke="currentColor"]')).not.toBeNull();
  });
});
