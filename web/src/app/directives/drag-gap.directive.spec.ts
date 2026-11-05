import { Component, provideZonelessChangeDetection, signal, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DragContextService } from '../services/drag-context.service';
import { DragGapDirective } from './drag-gap.directive';

@Component({
  selector: 'app-test-host',
  template: `
    <div
      [appDragGap]="itemIndex()"
      [gapContainerKey]="containerKey()"
      [gapGroupKey]="groupKey()"
      [gapItemId]="itemId()"
      [gapTotalItems]="totalItems()"
      #dragGap="dragGap"
    >
      Test Content
    </div>
  `,
  imports: [DragGapDirective],
})
class TestHostComponent {
  itemIndex = signal(0);
  containerKey = signal('default');
  groupKey = signal<string | undefined>(undefined);
  itemId = signal('item-1');
  totalItems = signal(5);

  dragGap = viewChild<DragGapDirective>('dragGap');
}

describe('DragGapDirective', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let component: TestHostComponent;
  let mockDragContext: {
    getGapMargin: ReturnType<typeof vi.fn>;
    getEndGapMargin: ReturnType<typeof vi.fn>;
    isItemBeingDragged: ReturnType<typeof vi.fn>;
    isDragging: ReturnType<typeof vi.fn>;
  };

  /**
   * Helper to create a fresh fixture with specific mock return values.
   * This is needed because computed signals are memoized and won't
   * recalculate when mock return values change after creation.
   */
  async function createFixtureWithMockValues(values: {
    getGapMargin?: number;
    getEndGapMargin?: number;
    isItemBeingDragged?: boolean;
    isDragging?: boolean;
  }): Promise<ComponentFixture<TestHostComponent>> {
    mockDragContext.getGapMargin.mockReturnValue(values.getGapMargin ?? 0);
    mockDragContext.getEndGapMargin.mockReturnValue(values.getEndGapMargin ?? 0);
    mockDragContext.isItemBeingDragged.mockReturnValue(values.isItemBeingDragged ?? false);
    mockDragContext.isDragging.mockReturnValue(values.isDragging ?? false);

    const newFixture = TestBed.createComponent(TestHostComponent);
    newFixture.detectChanges();
    await newFixture.whenStable();
    return newFixture;
  }

  beforeEach(async () => {
    mockDragContext = {
      getGapMargin: vi.fn().mockReturnValue(0),
      getEndGapMargin: vi.fn().mockReturnValue(0),
      isItemBeingDragged: vi.fn().mockReturnValue(false),
      isDragging: vi.fn().mockReturnValue(false),
    };

    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
      providers: [provideZonelessChangeDetection(), { provide: DragContextService, useValue: mockDragContext }],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHostComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  describe('initialization', () => {
    it('should create directive', () => {
      expect(component.dragGap()).toBeTruthy();
    });

    it('should export as dragGap', () => {
      expect(component.dragGap()).toBeTruthy();
    });

    it('should have drag-gap-item class', () => {
      const element = fixture.nativeElement.querySelector('div');
      expect(element.classList.contains('drag-gap-item')).toBe(true);
    });
  });

  describe('gapMargin computed', () => {
    it('should call getGapMargin with correct initial parameters', () => {
      const directive = component.dragGap()!;
      directive.gapMargin();

      // Initial values: itemIndex=0, containerKey='default', groupKey=undefined, allowCrossGroupDrop=false
      expect(mockDragContext.getGapMargin).toHaveBeenCalledWith(0, 'default', undefined, false);
    });

    it('should return value from getGapMargin when gap is active', async () => {
      // Create fixture with mock already returning 48
      const fixtureWithGap = await createFixtureWithMockValues({ getGapMargin: 48 });

      const directive = fixtureWithGap.componentInstance.dragGap()!;
      expect(directive.gapMargin()).toBe(48);
    });
  });

  describe('endGapMargin computed', () => {
    it('should call getEndGapMargin with correct initial parameters', () => {
      const directive = component.dragGap()!;
      directive.endGapMargin();

      // Initial values: itemIndex=0, containerKey='default', totalItems=5, groupKey=undefined, allowCrossGroupDrop=false
      expect(mockDragContext.getEndGapMargin).toHaveBeenCalledWith(0, 'default', 5, undefined, false);
    });

    it('should return value from getEndGapMargin when end gap is active', async () => {
      // Create fixture with mock already returning 56
      const fixtureWithGap = await createFixtureWithMockValues({ getEndGapMargin: 56 });

      const directive = fixtureWithGap.componentInstance.dragGap()!;
      expect(directive.endGapMargin()).toBe(56);
    });
  });

  describe('isBeingDragged computed', () => {
    it('should call isItemBeingDragged with item id', () => {
      const directive = component.dragGap()!;
      directive.isBeingDragged();

      expect(mockDragContext.isItemBeingDragged).toHaveBeenCalledWith('item-1');
    });

    it('should return true when item is being dragged', async () => {
      const fixtureWithDrag = await createFixtureWithMockValues({ isItemBeingDragged: true });

      const directive = fixtureWithDrag.componentInstance.dragGap()!;
      expect(directive.isBeingDragged()).toBe(true);
    });

    it('should return false when item is not being dragged', () => {
      const directive = component.dragGap()!;
      expect(directive.isBeingDragged()).toBe(false);
    });
  });

  describe('isDragEnded getter', () => {
    it('should return true when not dragging', () => {
      const directive = component.dragGap()!;
      expect(directive.isDragEnded).toBe(true);
    });

    it('should return false when isDragging returns true', () => {
      // Test the getter logic directly - isDragEnded returns !isDragging()
      mockDragContext.isDragging.mockReturnValue(true);

      // Create a new fixture with the updated mock
      // Since the getter calls isDragging() directly (not a computed),
      // it should return the current mock value
      const directive = component.dragGap()!;
      expect(directive.isDragEnded).toBe(false);
    });
  });

  describe('marginTop getter', () => {
    it('should return value from gapMargin computed', async () => {
      const fixtureWithGap = await createFixtureWithMockValues({ getGapMargin: 48 });

      const directive = fixtureWithGap.componentInstance.dragGap()!;
      expect(directive.marginTop).toBe(48);
    });

    it('should return 0 when no gap', () => {
      const directive = component.dragGap()!;
      expect(directive.marginTop).toBe(0);
    });
  });

  describe('marginBottom getter', () => {
    it('should return value from endGapMargin computed', async () => {
      const fixtureWithGap = await createFixtureWithMockValues({ getEndGapMargin: 56 });

      const directive = fixtureWithGap.componentInstance.dragGap()!;
      expect(directive.marginBottom).toBe(56);
    });

    it('should return 0 when no end gap', () => {
      const directive = component.dragGap()!;
      expect(directive.marginBottom).toBe(0);
    });
  });

  describe('host bindings', () => {
    it('should have drag-ended class when not dragging', () => {
      fixture.detectChanges();

      const element = fixture.nativeElement.querySelector('div');
      expect(element.classList.contains('drag-ended')).toBe(true);
    });

    it('should set margin-top style to 0 initially', () => {
      fixture.detectChanges();

      const element = fixture.nativeElement.querySelector('div') as HTMLElement;
      expect(element.style.marginTop).toBe('0px');
    });

    it('should set margin-bottom style to 0 initially', () => {
      fixture.detectChanges();

      const element = fixture.nativeElement.querySelector('div') as HTMLElement;
      expect(element.style.marginBottom).toBe('0px');
    });

    it('should set margin-top style when gap is active', async () => {
      const fixtureWithGap = await createFixtureWithMockValues({ getGapMargin: 48 });

      const element = fixtureWithGap.nativeElement.querySelector('div') as HTMLElement;
      expect(element.style.marginTop).toBe('48px');
    });

    it('should set margin-bottom style when end gap is active', async () => {
      const fixtureWithGap = await createFixtureWithMockValues({ getEndGapMargin: 56 });

      const element = fixtureWithGap.nativeElement.querySelector('div') as HTMLElement;
      expect(element.style.marginBottom).toBe('56px');
    });
  });

  describe('default values', () => {
    it('should use default totalItems of 0', async () => {
      // Create component without setting totalItems
      @Component({
        selector: 'app-test-minimal',
        template: ` <div [appDragGap]="0" [gapItemId]="'item-1'" #dragGap="dragGap">Content</div> `,
        imports: [DragGapDirective],
      })
      class MinimalHostComponent {
        dragGap = viewChild<DragGapDirective>('dragGap');
      }

      const minimalFixture = TestBed.createComponent(MinimalHostComponent);
      minimalFixture.detectChanges();
      await minimalFixture.whenStable();

      const directive = minimalFixture.componentInstance.dragGap()!;
      directive.endGapMargin();

      expect(mockDragContext.getEndGapMargin).toHaveBeenCalledWith(
        0,
        'default',
        0, // Default totalItems
        undefined,
        false // Default allowCrossGroupDrop
      );
    });
  });
});
