import {
  afterNextRender,
  computed,
  DestroyRef,
  Directive,
  ElementRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { type Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { DragContextService } from '../services/drag-context.service';
import type { DragData } from './drag-source.directive';

/**
 * Data attached to a drop target element.
 * Extends Record to satisfy Pragmatic DnD's type requirements.
 */
export interface DropData extends Record<string, unknown> {
  type: 'group-container' | 'group' | 'account-container' | 'account' | 'category-group' | 'category';
  id?: string;
  index?: number;
  groupLabel?: string;
  /** Category group type for constraint checking */
  groupType?: string;
  /** When true, always use the specified index regardless of edge (for group headers) */
  isGroupHeader?: boolean;
}

/**
 * Event emitted when an item is dropped on this target.
 */
export interface DropEvent {
  source: DragData;
  target: DropData;
  closestEdge: Edge | null;
}

/** Symbol for attaching edge data */
const edgeKey = Symbol('stickyEdge');

/**
 * Attaches edge data for drop targeting.
 *
 * Uses 50% threshold for edge detection - when cursor is in the top half of an item,
 * the drop will insert before; when in the bottom half, it inserts after.
 *
 * When a gap is present above an item (due to margin-top from the gap placeholder),
 * we need to account for this in the calculation to prevent jittering.
 */
function attachStickyEdge(
  userData: Record<string | symbol, unknown>,
  options: {
    element: HTMLElement;
    input: { clientX: number; clientY: number };
    gapHeight?: number;
  }
): Record<string | symbol, unknown> {
  const { element, input } = options;

  const rect = element.getBoundingClientRect();

  // Use the element's actual bounding rect without gap adjustment
  // The gap creates space BEFORE the element, but the element's rect
  // already reflects its actual position on screen
  const relativeY = (input.clientY - rect.top) / rect.height;

  // Simple 50% threshold - top half = 'top' edge, bottom half = 'bottom' edge
  const edge: Edge = relativeY < 0.5 ? 'top' : 'bottom';

  return { ...userData, [edgeKey]: edge };
}

/**
 * Extract the sticky edge from user data
 */
function extractStickyEdge(userData: Record<string | symbol, unknown>): Edge | null {
  return (userData[edgeKey] as Edge) ?? null;
}

/**
 * Directive that makes an element a drop target using Pragmatic Drag and Drop.
 * Exposes state signals for drop indicator positioning.
 *
 * Uses 50% threshold for edge detection - when cursor is in the top half,
 * the item will be inserted before; when in the bottom half, it inserts after.
 *
 * @example
 * ```html
 * <div
 *   [appDropTarget]="{ type: 'group', id: group.label, index: groupIndex }"
 *   [acceptTypes]="['group']"
 *   (dropped)="onGroupDropped($event)"
 *   #dropTarget="dropTarget"
 * >
 *   Drop target content
 *   <!-- Use dropTarget.closestEdge() and dropTarget.isOver() for indicators -->
 * </div>
 * ```
 */
@Directive({
  selector: '[appDropTarget]',
  exportAs: 'dropTarget',
})
export class DropTargetDirective {
  private readonly elementRef = inject(ElementRef<HTMLElement>);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dragContext = inject(DragContextService);

  /** Data to attach to this drop target */
  readonly dropData = input.required<DropData>({ alias: 'appDropTarget' });

  /** Types of drag sources to accept (matches DragData.type) */
  readonly acceptTypes = input<string[]>([]);

  /** Whether dropping is disabled */
  readonly dropDisabled = input<boolean>(false);

  /** Custom validation function for fine-grained drop acceptance (e.g., credit card constraints) */
  readonly canAcceptDrop = input<((source: DragData) => boolean) | null>(null);

  /** Container key for coordinating drag state across items */
  readonly containerKey = input<string>('default');

  /** Emitted when an item is dropped on this target */
  readonly dropped = output<DropEvent>();

  /** Emitted when a dragged item enters or moves over this target */
  readonly dragOver = output<Edge | null>();

  /** Emitted when a dragged item leaves this target */
  readonly dragLeave = output<void>();

  /** The closest edge ('top' or 'bottom') of the dragged item - used for drop logic */
  readonly closestEdge = signal<Edge | null>(null);

  /** Whether a valid drag is currently over this target */
  readonly isOver = signal<boolean>(false);

  /**
   * The edge to use for visual indicator display.
   * This is the same as closestEdge - the indicator shows at the top or bottom
   * of the currently hovered item based on cursor position.
   */
  readonly indicatorEdge = computed<Edge | null>(() => this.closestEdge());

  constructor() {
    afterNextRender(() => {
      this.setupDropTarget();
    });
  }

  private setupDropTarget(): void {
    /* Pragmatic DnD types are not properly exported. */
    const cleanup: () => void = dropTargetForElements({
      element: this.elementRef.nativeElement,
      getData: ({ input, element }) => {
        const dropData = this.dropData();
        // Get the current gap height for this item to adjust edge detection
        const gapHeight = this.dragContext.getGapMargin(dropData.index ?? 0, this.containerKey(), dropData.groupLabel);
        return attachStickyEdge(dropData as unknown as Record<string | symbol, unknown>, {
          input,
          element: element as HTMLElement,
          gapHeight,
        });
      },
      canDrop: ({ source }) => {
        if (this.dropDisabled()) return false;
        const types = this.acceptTypes();
        if (types.length > 0 && !types.includes(source.data['type'] as string)) {
          return false;
        }
        // Check custom validation if provided
        const customValidator = this.canAcceptDrop();
        if (customValidator && !customValidator(source.data as DragData)) {
          return false;
        }
        return true;
      },
      getIsSticky: ({ source }) => {
        const dropData = this.dropData();
        // Don't be sticky for self-drops (dragging item over itself)
        const isSameItem = source.data['id'] === dropData.id && source.data['type'] === dropData.type;
        return !isSameItem;
      },
      onDragEnter: ({ self, source }) => {
        const dropData = this.dropData();
        const isSameItem = source.data['id'] === dropData.id && source.data['type'] === dropData.type;

        // Don't show indicator when hovering over the dragged item itself
        if (isSameItem) {
          return;
        }
        const edge = extractStickyEdge(self.data);
        this.closestEdge.set(edge);
        this.isOver.set(true);
        this.dragOver.emit(edge);

        // Always update drag context position - use edge if available, default to 'bottom' otherwise
        // This ensures we always have a valid drop target even if cursor is in dead zone
        const effectiveEdge = edge ?? 'bottom';
        this.updateDragContextPosition(dropData, effectiveEdge);
      },
      onDrag: ({ self, source }) => {
        // Don't show indicator when hovering over the dragged item itself
        const dropData = this.dropData();
        if (source.data['id'] === dropData.id && source.data['type'] === dropData.type) {
          return;
        }
        const edge = extractStickyEdge(self.data);
        // Only update if edge actually changed
        if (edge !== this.closestEdge()) {
          this.closestEdge.set(edge);
          this.dragOver.emit(edge);

          // Always update drag context position - use edge if available, default to 'bottom' otherwise
          const effectiveEdge = edge ?? 'bottom';
          this.updateDragContextPosition(dropData, effectiveEdge);
        }
      },
      onDragLeave: () => {
        this.closestEdge.set(null);
        this.isOver.set(false);
        this.dragLeave.emit();
        // Don't clear drop position here - let it persist until cursor enters another valid target
        // This prevents the gap from disappearing when cursor is in the gap area

        // If leaving a group header, clear the flag so category rows can update again
        const dropData = this.dropData();
        if (dropData.isGroupHeader) {
          this.dragContext.clearGroupHeaderFlag();
        }
      },
      onDrop: ({ source, self }) => {
        const edge = extractStickyEdge(self.data);
        // Default to 'bottom' for consistency (same as onDragEnter/onDrag)
        const effectiveEdge = edge ?? 'bottom';
        this.closestEdge.set(null);
        this.isOver.set(false);
        this.dropped.emit({
          source: source.data as DragData,
          target: this.dropData(),
          closestEdge: effectiveEdge,
        });
      },
    });

    this.destroyRef.onDestroy(() => cleanup());
  }

  /**
   * Calculate the insertion index based on drop target and edge,
   * then update the drag context service.
   */
  private updateDragContextPosition(dropData: DropData, edge: Edge | null): void {
    const targetIndex = dropData.index ?? 0;

    // For group headers, always use the specified index (don't adjust based on edge)
    // This ensures the gap always appears at position 0 when hovering over a group header
    let insertionIndex: number;
    if (dropData.isGroupHeader) {
      insertionIndex = targetIndex;
    } else {
      // If edge is 'bottom', insert after this item (index + 1)
      // If edge is 'top', insert before this item (index)
      insertionIndex = edge === 'bottom' ? targetIndex + 1 : targetIndex;
    }

    // Store the drop target data along with the computed edge for fallback handling
    const dropTargetDataWithEdge = {
      ...dropData,
      closestEdge: edge,
    };

    this.dragContext.updateDropPosition(insertionIndex, this.containerKey(), dropTargetDataWithEdge);
  }
}
