import '@analogjs/vitest-angular/setup-snapshots';
import '@angular/compiler';

import { NgModule, provideZonelessChangeDetection } from '@angular/core';
import { getTestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { afterEach } from 'vitest';

class TestResizeObserver implements ResizeObserver {
  private readonly observedElements = new Set<Element>();

  constructor(callback: ResizeObserverCallback) {
    void callback;
  }

  observe(target: Element, options?: ResizeObserverOptions): void {
    void options;
    this.observedElements.add(target);
  }

  unobserve(target: Element): void {
    this.observedElements.delete(target);
  }

  disconnect(): void {
    this.observedElements.clear();
  }
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    writable: true,
    value: TestResizeObserver,
  });
}

@NgModule({
  providers: [provideZonelessChangeDetection()],
})
export class ZonelessTestModule {}

// Only initialize test environment if it hasn't been initialized already
const testBed = getTestBed();
if (!testBed.platform) {
  testBed.initTestEnvironment([BrowserTestingModule, ZonelessTestModule], platformBrowserTesting());
}

// Reset TestBed after each test to prevent state pollution between test files
afterEach(() => {
  const testBed = getTestBed();
  testBed.resetTestingModule();
});
