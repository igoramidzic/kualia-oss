import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DragContextService, DragItemData } from './drag-context.service';

describe('DragContextService', () => {
  let service: DragContextService;

  // Helper to create DragItemData
  const createItem = (id: string, type: string, index: number, groupKey?: string): DragItemData => ({
    id,
    type,
    index,
    groupKey,
  });

  beforeEach(() => {
    // Mock requestAnimationFrame and queueMicrotask for endDrag tests
    vi.useFakeTimers();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), DragContextService],
    });

    service = TestBed.inject(DragContextService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initial state', () => {
    it('should start with no drag in progress', () => {
      expect(service.isDragging()).toBe(false);
      expect(service.draggedItem()).toBeNull();
      expect(service.draggedHeight()).toBe(0);
      expect(service.dropTargetIndex()).toBeNull();
      expect(service.dropTargetGroupKey()).toBeNull();
      expect(service.containerKey()).toBeNull();
      expect(service.lastDropTargetData()).toBeNull();
    });
  });

  describe('startDrag', () => {
    it('should set isDragging to true', () => {
      const item = createItem('item-1', 'account', 0);

      service.startDrag(item, 48, 'accounts');

      expect(service.isDragging()).toBe(true);
    });

    it('should store the dragged item data', () => {
      const item = createItem('item-1', 'account', 2, 'group-1');

      service.startDrag(item, 48, 'accounts');

      expect(service.draggedItem()).toEqual(item);
    });

    it('should store the dragged element height', () => {
      const item = createItem('item-1', 'account', 0);

      service.startDrag(item, 56, 'accounts');

      expect(service.draggedHeight()).toBe(56);
    });

    it('should store the container key', () => {
      const item = createItem('item-1', 'group', 0);

      service.startDrag(item, 48, 'groups');

      expect(service.containerKey()).toBe('groups');
    });

    it('should reset drop target state', () => {
      const item = createItem('item-1', 'account', 0);

      // First start a drag and update position
      service.startDrag(item, 48, 'accounts');
      service.updateDropPosition(2, 'accounts');

      // Start a new drag
      const item2 = createItem('item-2', 'account', 1);
      service.startDrag(item2, 48, 'accounts');

      expect(service.dropTargetIndex()).toBeNull();
      expect(service.dropTargetGroupKey()).toBeNull();
      expect(service.lastDropTargetData()).toBeNull();
    });
  });

  describe('updateDropPosition', () => {
    it('should update drop target index when dragging', () => {
      const item = createItem('item-1', 'account', 0);
      service.startDrag(item, 48, 'accounts');

      service.updateDropPosition(3, 'accounts');

      expect(service.dropTargetIndex()).toBe(3);
    });

    it('should ignore updates when not dragging', () => {
      service.updateDropPosition(3, 'accounts');

      expect(service.dropTargetIndex()).toBeNull();
    });

    it('should ignore updates for wrong container', () => {
      const item = createItem('item-1', 'account', 0);
      service.startDrag(item, 48, 'accounts');

      service.updateDropPosition(3, 'groups');

      expect(service.dropTargetIndex()).toBeNull();
    });

    it('should extract and store group key from drop target data', () => {
      const item = createItem('item-1', 'account', 0, 'group-1');
      service.startDrag(item, 48, 'accounts');

      service.updateDropPosition(2, 'accounts', { groupLabel: 'group-1' });

      expect(service.dropTargetGroupKey()).toBe('group-1');
    });

    it('should store last drop target data', () => {
      const item = createItem('item-1', 'account', 0);
      service.startDrag(item, 48, 'accounts');
      const dropData = { type: 'account', id: 'item-2', index: 2 };

      service.updateDropPosition(2, 'accounts', dropData);

      expect(service.lastDropTargetData()).toEqual(dropData);
    });

    it('should preserve last drop target data when dropTargetData is not provided', () => {
      const item = createItem('item-1', 'account', 0);
      service.startDrag(item, 48, 'accounts');
      const dropData = { type: 'account', id: 'item-2', index: 2 };

      service.updateDropPosition(2, 'accounts', dropData);
      // Update with new index but no new drop target data - should be debounced
      // Wait for debounce
      vi.advanceTimersByTime(60);
      service.updateDropPosition(3, 'accounts');

      expect(service.lastDropTargetData()).toEqual(dropData);
    });

    it('should debounce rapid index updates', () => {
      const item = createItem('item-1', 'account', 0);
      service.startDrag(item, 48, 'accounts');

      // First update should work
      service.updateDropPosition(1, 'accounts');
      expect(service.dropTargetIndex()).toBe(1);

      // Rapid update within debounce window should be ignored
      vi.advanceTimersByTime(30);
      service.updateDropPosition(2, 'accounts');
      expect(service.dropTargetIndex()).toBe(1);

      // After debounce window, update should work
      vi.advanceTimersByTime(30);
      service.updateDropPosition(3, 'accounts');
      expect(service.dropTargetIndex()).toBe(3);
    });
  });

  describe('clearDropPosition', () => {
    it('should set dropTargetIndex to null', () => {
      const item = createItem('item-1', 'account', 0);
      service.startDrag(item, 48, 'accounts');
      service.updateDropPosition(3, 'accounts');

      service.clearDropPosition();

      expect(service.dropTargetIndex()).toBeNull();
    });

    it('should preserve other drag state', () => {
      const item = createItem('item-1', 'account', 0);
      service.startDrag(item, 48, 'accounts');
      service.updateDropPosition(3, 'accounts');

      service.clearDropPosition();

      expect(service.isDragging()).toBe(true);
      expect(service.draggedItem()).toEqual(item);
      expect(service.containerKey()).toBe('accounts');
    });
  });

  describe('endDrag', () => {
    it('should reset all state after animation frame and microtask', async () => {
      const item = createItem('item-1', 'account', 0);
      service.startDrag(item, 48, 'accounts');
      service.updateDropPosition(3, 'accounts', { type: 'account' });

      service.endDrag();

      // State should still be set before RAF
      expect(service.isDragging()).toBe(true);

      // Trigger requestAnimationFrame callback and microtasks
      vi.advanceTimersByTime(16);
      // Wait for microtask queue to flush
      await Promise.resolve();

      expect(service.isDragging()).toBe(false);
      expect(service.draggedItem()).toBeNull();
      expect(service.draggedHeight()).toBe(0);
      expect(service.dropTargetIndex()).toBeNull();
      expect(service.containerKey()).toBeNull();
      expect(service.lastDropTargetData()).toBeNull();
    });
  });

  describe('isItemBeingDragged', () => {
    it('should return true for the dragged item', () => {
      const item = createItem('item-1', 'account', 0);
      service.startDrag(item, 48, 'accounts');

      expect(service.isItemBeingDragged('item-1')).toBe(true);
    });

    it('should return false for other items', () => {
      const item = createItem('item-1', 'account', 0);
      service.startDrag(item, 48, 'accounts');

      expect(service.isItemBeingDragged('item-2')).toBe(false);
    });

    it('should return false when not dragging', () => {
      expect(service.isItemBeingDragged('item-1')).toBe(false);
    });
  });

  describe('getGapMargin', () => {
    it('should return 0 when not dragging', () => {
      const margin = service.getGapMargin(2, 'accounts');
      expect(margin).toBe(0);
    });

    it('should return 0 for wrong container', () => {
      const item = createItem('item-1', 'account', 0);
      service.startDrag(item, 48, 'accounts');
      service.updateDropPosition(2, 'accounts');

      const margin = service.getGapMargin(2, 'groups');
      expect(margin).toBe(0);
    });

    it('should return 0 when no drop target set', () => {
      const item = createItem('item-1', 'account', 0);
      service.startDrag(item, 48, 'accounts');

      const margin = service.getGapMargin(2, 'accounts');
      expect(margin).toBe(0);
    });

    it('should return dragged height for item at drop target index', () => {
      const item = createItem('item-1', 'account', 0);
      service.startDrag(item, 48, 'accounts');
      service.updateDropPosition(2, 'accounts');

      const margin = service.getGapMargin(2, 'accounts');
      expect(margin).toBe(48);
    });

    it('should return 0 for items not at drop target index', () => {
      const item = createItem('item-1', 'account', 0);
      service.startDrag(item, 48, 'accounts');
      service.updateDropPosition(2, 'accounts');

      expect(service.getGapMargin(0, 'accounts')).toBe(0);
      expect(service.getGapMargin(1, 'accounts')).toBe(0);
      expect(service.getGapMargin(3, 'accounts')).toBe(0);
    });

    describe('with groupKey', () => {
      it('should return margin when item is in source group and drop target is in source group', () => {
        const item = createItem('item-1', 'account', 0, 'group-1');
        service.startDrag(item, 48, 'accounts');
        service.updateDropPosition(2, 'accounts', { groupLabel: 'group-1' });

        const margin = service.getGapMargin(2, 'accounts', 'group-1');
        expect(margin).toBe(48);
      });

      it('should return 0 when item is in different group than source', () => {
        const item = createItem('item-1', 'account', 0, 'group-1');
        service.startDrag(item, 48, 'accounts');
        service.updateDropPosition(2, 'accounts', { groupLabel: 'group-1' });

        const margin = service.getGapMargin(2, 'accounts', 'group-2');
        expect(margin).toBe(0);
      });

      it('should return 0 when drop target is in different group than source', () => {
        const item = createItem('item-1', 'account', 0, 'group-1');
        service.startDrag(item, 48, 'accounts');
        service.updateDropPosition(2, 'accounts', { groupLabel: 'group-2' });

        const margin = service.getGapMargin(2, 'accounts', 'group-1');
        expect(margin).toBe(0);
      });
    });
  });

  describe('getEndGapMargin', () => {
    it('should return 0 when not dragging', () => {
      const margin = service.getEndGapMargin(2, 'accounts', 3);
      expect(margin).toBe(0);
    });

    it('should return 0 for wrong container', () => {
      const item = createItem('item-1', 'account', 0);
      service.startDrag(item, 48, 'accounts');
      service.updateDropPosition(3, 'accounts');

      const margin = service.getEndGapMargin(2, 'groups', 3);
      expect(margin).toBe(0);
    });

    it('should return 0 when no drop target set', () => {
      const item = createItem('item-1', 'account', 0);
      service.startDrag(item, 48, 'accounts');

      const margin = service.getEndGapMargin(2, 'accounts', 3);
      expect(margin).toBe(0);
    });

    it('should return dragged height when last item and drop is at end', () => {
      const item = createItem('item-1', 'account', 0);
      service.startDrag(item, 48, 'accounts');
      // Drop at end (index = totalItems)
      service.updateDropPosition(3, 'accounts');

      // Check last item (index 2 in a list of 3)
      const margin = service.getEndGapMargin(2, 'accounts', 3);
      expect(margin).toBe(48);
    });

    it('should return 0 for last item when drop is not at end', () => {
      const item = createItem('item-1', 'account', 0);
      service.startDrag(item, 48, 'accounts');
      service.updateDropPosition(1, 'accounts');

      const margin = service.getEndGapMargin(2, 'accounts', 3);
      expect(margin).toBe(0);
    });

    it('should return 0 for non-last items even when drop is at end', () => {
      const item = createItem('item-1', 'account', 0);
      service.startDrag(item, 48, 'accounts');
      service.updateDropPosition(3, 'accounts');

      expect(service.getEndGapMargin(0, 'accounts', 3)).toBe(0);
      expect(service.getEndGapMargin(1, 'accounts', 3)).toBe(0);
    });

    describe('with groupKey', () => {
      it('should return margin when last item in source group and drop is at end of source group', () => {
        const item = createItem('item-1', 'account', 0, 'group-1');
        service.startDrag(item, 48, 'accounts');
        service.updateDropPosition(3, 'accounts', { groupLabel: 'group-1' });

        const margin = service.getEndGapMargin(2, 'accounts', 3, 'group-1');
        expect(margin).toBe(48);
      });

      it('should return 0 when item is in different group than source', () => {
        const item = createItem('item-1', 'account', 0, 'group-1');
        service.startDrag(item, 48, 'accounts');
        service.updateDropPosition(3, 'accounts', { groupLabel: 'group-1' });

        const margin = service.getEndGapMargin(2, 'accounts', 3, 'group-2');
        expect(margin).toBe(0);
      });

      it('should return 0 when drop target is in different group than source', () => {
        const item = createItem('item-1', 'account', 0, 'group-1');
        service.startDrag(item, 48, 'accounts');
        service.updateDropPosition(3, 'accounts', { groupLabel: 'group-2' });

        const margin = service.getEndGapMargin(2, 'accounts', 3, 'group-1');
        expect(margin).toBe(0);
      });
    });
  });

  describe('computed signals', () => {
    it('should update isDragging signal when drag starts/ends', async () => {
      expect(service.isDragging()).toBe(false);

      const item = createItem('item-1', 'account', 0);
      service.startDrag(item, 48, 'accounts');
      expect(service.isDragging()).toBe(true);

      service.endDrag();
      vi.advanceTimersByTime(16);
      await Promise.resolve();
      expect(service.isDragging()).toBe(false);
    });

    it('should update draggedItem signal when drag starts', () => {
      const item = createItem('item-1', 'account', 2, 'group-1');

      expect(service.draggedItem()).toBeNull();

      service.startDrag(item, 48, 'accounts');

      expect(service.draggedItem()).toEqual(item);
    });

    it('should update dropTargetIndex signal when position updates', () => {
      const item = createItem('item-1', 'account', 0);
      service.startDrag(item, 48, 'accounts');

      expect(service.dropTargetIndex()).toBeNull();

      service.updateDropPosition(2, 'accounts');

      expect(service.dropTargetIndex()).toBe(2);
    });
  });

  describe('edge cases', () => {
    it('should handle dragging first item', () => {
      const item = createItem('item-0', 'account', 0);
      service.startDrag(item, 48, 'accounts');
      service.updateDropPosition(0, 'accounts');

      expect(service.getGapMargin(0, 'accounts')).toBe(48);
    });

    it('should handle empty group key', () => {
      const item = createItem('item-1', 'account', 0, '');
      service.startDrag(item, 48, 'accounts');
      service.updateDropPosition(2, 'accounts', { groupLabel: '' });

      // Empty string is still a valid group key
      expect(service.getGapMargin(2, 'accounts', '')).toBe(48);
    });

    it('should handle zero height dragged element', () => {
      const item = createItem('item-1', 'account', 0);
      service.startDrag(item, 0, 'accounts');
      service.updateDropPosition(2, 'accounts');

      expect(service.getGapMargin(2, 'accounts')).toBe(0);
    });

    it('should handle negative index (though unusual)', () => {
      const item = createItem('item-1', 'account', 0);
      service.startDrag(item, 48, 'accounts');

      // Should not throw
      const margin = service.getGapMargin(-1, 'accounts');
      expect(margin).toBe(0);
    });
  });
});
