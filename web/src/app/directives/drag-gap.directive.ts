import { computed, Directive, HostBinding, inject, input } from '@angular/core';
import { DragContextService } from '../services/drag-context.service';

/**
 * Directive that creates a gap/placeholder effect for drag-and-drop.
 * When an item is being dragged, items at the drop position will have
 * margin-top applied to create space for the dragged item.
 *
 * For the last item in a list, margin-bottom is used when dropping at the end.
 *
 * @example
 * ```html
 * <div
 *   [appDragSource]="{ type: 'account', id: account._id, index: i }"
 *   [containerKey]="'accounts'"
 *   [appDropTarget]="{ type: 'account', id: account._id, index: i }"
 *   [containerKey]="'accounts'"
 *   [appDragGap]="i"
 *   [gapContainerKey]="'accounts'"
 *   [gapItemId]="account._id"
 *   [gapTotalItems]="accounts.length"
 * >
 *   Content
 * </div>
 * ```
 */
@Directive({
  selector: '[appDragGap]',
  exportAs: 'dragGap',
})
export class DragGapDirective {
  private readonly dragContext = inject(DragContextService);

  /** The index of this item in the list */
  readonly itemIndex = input.required<number>({ alias: 'appDragGap' });

  /** Container key for coordinating with drag context */
  readonly gapContainerKey = input<string>('default');

  /** Optional group key for items within groups (e.g., accounts within a group) */
  readonly gapGroupKey = input<string | undefined>(undefined);

  /** The unique ID of this item (used to detect if this item is being dragged) */
  readonly gapItemId = input.required<string>();

  /** Total number of items in the list (required for end-of-list gap detection) */
  readonly gapTotalItems = input<number>(0);

  /** Allow gap to show in target group even when different from source group (for cross-group moves) */
  readonly allowCrossGroupDrop = input<boolean>(false);

  /** Computed gap margin - returns dragged item height or 0 */
  readonly gapMargin = computed(() =>
    this.dragContext.getGapMargin(
      this.itemIndex(),
      this.gapContainerKey(),
      this.gapGroupKey(),
      this.allowCrossGroupDrop()
    )
  );

  /** Computed end gap margin - returns dragged item height for last item when dropping at end */
  readonly endGapMargin = computed(() =>
    this.dragContext.getEndGapMargin(
      this.itemIndex(),
      this.gapContainerKey(),
      this.gapTotalItems(),
      this.gapGroupKey(),
      this.allowCrossGroupDrop()
    )
  );

  /** Whether this specific item is being dragged */
  readonly isBeingDragged = computed(() => this.dragContext.isItemBeingDragged(this.gapItemId()));

  /** Base class for transition support */
  @HostBinding('class.drag-gap-item')
  readonly hasDragGap = true;

  /** Disable transitions when not dragging so gap collapses instantly on drop */
  @HostBinding('class.drag-ended')
  get isDragEnded(): boolean {
    return !this.dragContext.isDragging();
  }

  /** Apply margin-top dynamically to create the gap */
  @HostBinding('style.margin-top.px')
  get marginTop(): number {
    return this.gapMargin();
  }

  /** Apply margin-bottom dynamically for end-of-list gap */
  @HostBinding('style.margin-bottom.px')
  get marginBottom(): number {
    return this.endGapMargin();
  }
}
