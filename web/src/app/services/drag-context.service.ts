import { computed, Injectable, signal } from '@angular/core';

/**
 * Data attached to a draggable item.
 */
export interface DragItemData {
  id: string;
  type: string;
  index: number;
  groupKey?: string;
}

/**
 * Internal drag state tracked by the service.
 */
interface DragState {
  isDragging: boolean;
  draggedItem: DragItemData | null;
  draggedHeight: number;
  containerKey: string | null;
  dropTargetIndex: number | null;
  /** The group key of the current drop target (for showing gap in correct group) */
  dropTargetGroupKey: string | null;
  /** Total count of items in the current drag container (used for end-of-list detection) */
  itemCount: number | null;
  /** Timestamp of last drop position update - used for debouncing */
  lastUpdateTime: number;
  /** The last valid drop target data (used when cursor leaves target during gap animation) */
  lastDropTargetData: Record<string, unknown> | null;
  /** Whether the cursor is currently over a group header drop target */
  isOverGroupHeader: boolean;
}

const INITIAL_STATE: DragState = {
  isDragging: false,
  draggedItem: null,
  draggedHeight: 0,
  containerKey: null,
  dropTargetIndex: null,
  dropTargetGroupKey: null,
  itemCount: null,
  lastUpdateTime: 0,
  lastDropTargetData: null,
  isOverGroupHeader: false,
};

/** Minimum time between drop position updates in milliseconds */
const UPDATE_DEBOUNCE_MS = 50;

/**
 * Service that coordinates drag-and-drop state across all items in a container.
 * This enables the "gap placeholder" effect where items shift to make room
 * for the dragged item at the drop position.
 *
 * @example
 * ```typescript
 * // In drag source directive
 * this.dragContext.startDrag({ id: 'item-1', type: 'account', index: 2 }, 48, 'accounts');
 *
 * // In drop target directive
 * this.dragContext.updateDropPosition(4, 'accounts');
 *
 * // In gap directive - check if this item should show a gap
 * const margin = this.dragContext.getGapMargin(3, 'accounts');
 * ```
 */
@Injectable({ providedIn: 'root' })
export class DragContextService {
  private readonly _state = signal<DragState>(INITIAL_STATE);

  /** Whether a drag operation is currently in progress */
  readonly isDragging = computed(() => this._state().isDragging);

  /** The item currently being dragged, or null */
  readonly draggedItem = computed(() => this._state().draggedItem);

  /** Height of the dragged item (used for gap sizing) */
  readonly draggedHeight = computed(() => this._state().draggedHeight);

  /** Current drop target position index */
  readonly dropTargetIndex = computed(() => this._state().dropTargetIndex);

  /** The group key of the current drop target */
  readonly dropTargetGroupKey = computed(() => this._state().dropTargetGroupKey);

  /** The container key where the drag is happening */
  readonly containerKey = computed(() => this._state().containerKey);

  /** The last drop target data (used for fallback when cursor leaves target) */
  readonly lastDropTargetData = computed(() => this._state().lastDropTargetData);

  /** Whether the cursor is currently over a group header drop target */
  readonly isOverGroupHeader = computed(() => this._state().isOverGroupHeader);

  /**
   * Start a drag operation.
   * @param item - Data about the item being dragged
   * @param height - Height of the dragged element in pixels
   * @param containerKey - Identifier for the container (e.g., 'groups', 'accounts')
   * @param itemCount - Total number of items in the container (used for end-of-list gap)
   */
  startDrag(item: DragItemData, height: number, containerKey: string, itemCount?: number): void {
    this._state.set({
      isDragging: true,
      draggedItem: item,
      draggedHeight: height,
      containerKey,
      dropTargetIndex: null,
      dropTargetGroupKey: null,
      itemCount: itemCount ?? null,
      lastUpdateTime: 0,
      lastDropTargetData: null,
      isOverGroupHeader: false,
    });
  }

  /**
   * Update the current drop target position.
   * @param index - The index where the item would be inserted
   * @param containerKey - The container key (must match the active drag container)
   * @param dropTargetData - Optional data from the drop target element
   */
  updateDropPosition(index: number, containerKey: string, dropTargetData?: Record<string, unknown>): void {
    const state = this._state();
    if (!state.isDragging || state.containerKey !== containerKey) {
      return;
    }

    // Check if this update is from a group header
    const isGroupHeader = (dropTargetData?.['isGroupHeader'] as boolean) ?? false;

    // If we're currently over a group header and this update is NOT from a group header, ignore it
    // This prevents category row drop targets from overriding the group header when both fire
    if (state.isOverGroupHeader && !isGroupHeader) {
      return;
    }

    // Extract group key from drop target data (e.g., groupLabel for bank accounts)
    const newGroupKey = (dropTargetData?.['groupLabel'] as string | undefined) ?? null;

    // Always update lastDropTargetData if provided (for fallback drop handling)
    // But only update dropTargetIndex if it changed (for gap positioning)
    const indexChanged = state.dropTargetIndex !== index;
    const groupChanged = state.dropTargetGroupKey !== newGroupKey;
    const groupHeaderChanged = state.isOverGroupHeader !== isGroupHeader;

    // Debounce rapid index updates to prevent jitter
    const now = Date.now();
    const shouldUpdateIndex =
      indexChanged && (state.dropTargetIndex === null || now - state.lastUpdateTime >= UPDATE_DEBOUNCE_MS);

    if (shouldUpdateIndex || groupChanged || groupHeaderChanged || dropTargetData) {
      this._state.update((s) => ({
        ...s,
        dropTargetIndex: shouldUpdateIndex ? index : s.dropTargetIndex,
        dropTargetGroupKey: newGroupKey,
        lastUpdateTime: shouldUpdateIndex ? now : s.lastUpdateTime,
        lastDropTargetData: dropTargetData ?? s.lastDropTargetData,
        isOverGroupHeader: isGroupHeader,
      }));
    }
  }

  /**
   * Clear the drop target position (e.g., when dragging leaves a container).
   */
  clearDropPosition(): void {
    this._state.update((s) => ({
      ...s,
      dropTargetIndex: null,
    }));
  }

  /**
   * Clear the group header flag (called when leaving a group header drop target).
   */
  clearGroupHeaderFlag(): void {
    this._state.update((s) => ({
      ...s,
      isOverGroupHeader: false,
    }));
  }

  /**
   * End the current drag operation and reset state.
   * Uses a short delay to allow monitors to read the final state before clearing.
   */
  endDrag(): void {
    // Use requestAnimationFrame + microtask to ensure monitors can read state
    // before it's cleared, while still clearing quickly to avoid visual artifacts
    requestAnimationFrame(() => {
      queueMicrotask(() => {
        this._state.set(INITIAL_STATE);
      });
    });
  }

  /**
   * Check if a specific item is currently being dragged.
   * @param id - The item's unique identifier
   */
  isItemBeingDragged(id: string): boolean {
    const state = this._state();
    return state.isDragging && state.draggedItem?.id === id;
  }

  /**
   * Get the margin-top value for an item to create the gap effect.
   * Returns the dragged item's height if the gap should appear before this item,
   * otherwise returns 0.
   *
   * @param itemIndex - The index of the item to check
   * @param containerKey - The container this item belongs to
   * @param groupKey - Optional group key for items within groups
   * @param allowCrossGroup - If true, shows gap in target group even if different from source group
   */
  getGapMargin(itemIndex: number, containerKey: string, groupKey?: string, allowCrossGroup = false): number {
    const state = this._state();

    // No drag in progress
    if (!state.isDragging) return 0;

    // Wrong container
    if (state.containerKey !== containerKey) return 0;

    // No drop target set
    if (state.dropTargetIndex === null) return 0;

    // If groupKey is provided, check group constraints
    if (groupKey !== undefined) {
      const sourceGroup = state.draggedItem?.groupKey;

      if (allowCrossGroup) {
        // For cross-group movement: show gap in whichever group the cursor is hovering over
        if (groupKey !== state.dropTargetGroupKey) return 0;
      } else {
        // Original behavior: gap only shows in the source group, and only when hovering over that same group
        if (groupKey !== sourceGroup || state.dropTargetGroupKey !== sourceGroup) return 0;
      }
    }

    // Gap appears before the item at dropTargetIndex
    if (itemIndex === state.dropTargetIndex) {
      return state.draggedHeight;
    }

    return 0;
  }

  /**
   * Get the margin-bottom value for the last item when dropping at the end of a list.
   * Returns the dragged item's height if the drop position is at the end (after the last item),
   * otherwise returns 0.
   *
   * @param itemIndex - The index of the item to check
   * @param containerKey - The container this item belongs to
   * @param totalItems - Total number of items in the list
   * @param groupKey - Optional group key for items within groups
   * @param allowCrossGroup - If true, shows gap in target group even if different from source group
   */
  getEndGapMargin(
    itemIndex: number,
    containerKey: string,
    totalItems: number,
    groupKey?: string,
    allowCrossGroup = false
  ): number {
    const state = this._state();

    // No drag in progress
    if (!state.isDragging) return 0;

    // Wrong container
    if (state.containerKey !== containerKey) return 0;

    // No drop target set
    if (state.dropTargetIndex === null) return 0;

    // If groupKey is provided, check group constraints
    if (groupKey !== undefined) {
      const sourceGroup = state.draggedItem?.groupKey;

      if (allowCrossGroup) {
        // For cross-group movement: show gap in whichever group the cursor is hovering over
        if (groupKey !== state.dropTargetGroupKey) return 0;
      } else {
        // Original behavior: gap only shows in the source group, and only when hovering over that same group
        if (groupKey !== sourceGroup || state.dropTargetGroupKey !== sourceGroup) return 0;
      }
    }

    // Check if this is the last item and the drop target is at the end (after all items)
    const isLastItem = itemIndex === totalItems - 1;
    const isDropAtEnd = state.dropTargetIndex === totalItems;

    if (isLastItem && isDropAtEnd) {
      return state.draggedHeight;
    }

    return 0;
  }
}
