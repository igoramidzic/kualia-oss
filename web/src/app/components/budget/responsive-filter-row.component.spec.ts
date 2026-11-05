import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  nucleoArrowUp as ArrowUp,
  nucleoWarningCircle as CircleAlert,
  nucleoPlusCircle as CirclePlus,
  nucleoLayers as Layers,
  nucleoTrendDown as TrendingDown,
} from '@kualia/icons';
import { describe, expect, it } from 'vitest';
import { FilterConfig, ResponsiveFilterRowComponent } from './responsive-filter-row.component';

const filters: FilterConfig[] = [
  {
    id: 'all',
    label: 'All',
    icon: Layers,
    queryParams: {},
    isActive: true,
    count: 58,
    showCount: true,
  },
  {
    id: 'available',
    label: 'Available',
    icon: ArrowUp,
    queryParams: { filter: 'available' },
    count: 12,
    showCount: true,
  },
  {
    id: 'overspent',
    label: 'Overspent',
    icon: CircleAlert,
    queryParams: { filter: 'overspent' },
    isDestructive: true,
    count: 3,
    showCount: true,
  },
  {
    id: 'underfunded',
    label: 'Underfunded',
    icon: TrendingDown,
    queryParams: { filter: 'underfunded' },
    count: 8,
    showCount: true,
  },
  {
    id: 'extraFunded',
    label: 'Extra Funded',
    icon: CirclePlus,
    queryParams: { filter: 'extra-funded' },
    count: 5,
    showCount: true,
  },
];

const filterWidths = new Map<string, number>([
  ['all', 80],
  ['available', 112],
  ['overspent', 112],
  ['underfunded', 132],
  ['extraFunded', 132],
]);

function setElementNumberProperty(element: HTMLElement, property: 'clientWidth' | 'offsetWidth', value: number): void {
  Object.defineProperty(element, property, {
    configurable: true,
    get: () => value,
  });
}

describe('ResponsiveFilterRowComponent', () => {
  function createFixture(containerWidth: number): ComponentFixture<ResponsiveFilterRowComponent> {
    TestBed.configureTestingModule({
      imports: [ResponsiveFilterRowComponent],
      providers: [provideZonelessChangeDetection(), provideRouter([])],
    });

    const fixture = TestBed.createComponent(ResponsiveFilterRowComponent);
    fixture.componentRef.setInput('filters', filters);
    fixture.componentRef.setInput('containerClass', 'flex w-full min-w-0 items-center gap-1 overflow-hidden');
    fixture.detectChanges();

    const container = fixture.nativeElement.querySelector('div') as HTMLElement;
    container.style.paddingLeft = '0px';
    container.style.paddingRight = '0px';
    setElementNumberProperty(container, 'clientWidth', containerWidth);

    fixture.nativeElement.querySelectorAll<HTMLElement>('[data-measure-id]').forEach((element) => {
      const id = element.getAttribute('data-measure-id');
      setElementNumberProperty(element, 'offsetWidth', id ? (filterWidths.get(id) ?? 80) : 80);
    });

    fixture.nativeElement.querySelectorAll<HTMLElement>('[data-more-label-id]').forEach((element) => {
      const id = element.getAttribute('data-more-label-id');
      setElementNumberProperty(element, 'offsetWidth', id ? (filterWidths.get(id) ?? 80) + 24 : 104);
    });

    const genericMoreButton = Array.from(fixture.nativeElement.querySelectorAll<HTMLElement>('span')).find((element) =>
      element.textContent?.includes('5 more')
    );
    if (genericMoreButton) {
      setElementNumberProperty(genericMoreButton, 'offsetWidth', 88);
    }

    fixture.componentInstance['measureFilterWidths']();
    fixture.componentInstance['calculateLayout']();
    fixture.detectChanges();

    return fixture;
  }

  it('keeps all filters visible when the row has enough width', () => {
    const fixture = createFixture(700);

    expect(fixture.componentInstance.visibleFilters().map((filter) => filter.id)).toEqual(
      filters.map((filter) => filter.id)
    );
    expect(fixture.componentInstance.hiddenFilters()).toEqual([]);
  });

  it('moves overflowing filters into the more menu when the row is narrow', () => {
    const fixture = createFixture(220);

    expect(fixture.componentInstance.visibleFilters().length).toBeLessThan(filters.length);
    expect(fixture.componentInstance.hiddenFilters().length).toBeGreaterThan(0);
  });
});
