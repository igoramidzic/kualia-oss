import {
  afterNextRender,
  DestroyRef,
  Directive,
  ElementRef,
  HostBinding,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { DragContextService } from '../services/drag-context.service';

/**
 * Data attached to a draggable element.
 * Extends Record to satisfy Pragmatic DnD's type requirements.
 */
export interface DragData extends Record<string, unknown> {
  type: 'group' | 'account' | 'category-group' | 'category';
  id: string;
  index: number;
  groupLabel?: string;
  /** Category-specific: the type of category (for constraint checking) */
  categoryType?: string | null;
}

/**
 * Directive that makes an element draggable using Pragmatic Drag and Drop.
 *
 * @example
 * ```html
 * <div
 *   [appDragSource]="{ type: 'group', id: group.label, index: groupIndex }"
 *   (dragStart)="onDragStart()"
 *   (dragEnd)="onDragEnd()"
 * >
 *   Draggable content
 * </div>
 * ```
 */
@Directive({
  selector: '[appDragSource]',
})
export class DragSourceDirective {
  private readonly elementRef = inject(ElementRef<HTMLElement>);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dragContext = inject(DragContextService);

  /** Data to attach to the drag operation */
  readonly dragData = input.required<DragData>({ alias: 'appDragSource' });

  /** Whether dragging is disabled */
  readonly dragDisabled = input<boolean>(false);

  /** Container key for coordinating drag state across items */
  readonly containerKey = input<string>('default');

  /** Emitted when drag starts */
  readonly dragStart = output<DragData>();

  /** Emitted when drag ends (drop or cancel) */
  readonly dragEnd = output<void>();

  /** Whether this element is currently being dragged */
  readonly isDragging = signal(false);

  /** Apply ghosted/muted class when this specific item is being dragged */
  @HostBinding('class.is-drag-source-ghost')
  get ghostClass(): boolean {
    return this.dragContext.isItemBeingDragged(this.dragData().id);
  }

  constructor() {
    afterNextRender(() => {
      this.setupDraggable();
    });
  }

  private setupDraggable(): void {
    /* Pragmatic DnD types are not properly exported. */
    const cleanup: () => void = draggable({
      element: this.elementRef.nativeElement,
      getInitialData: () => this.dragData(),
      canDrag: () => !this.dragDisabled(),
      onDragStart: () => {
        // Capture height BEFORE any CSS changes affect the element
        const height = this.elementRef.nativeElement.offsetHeight as number;
        const data = this.dragData();

        // Notify the drag context service
        this.dragContext.startDrag(
          {
            id: data.id,
            type: data.type,
            index: data.index,
            groupKey: data.groupLabel,
          },
          height,
          this.containerKey()
        );

        this.isDragging.set(true);
        this.dragStart.emit(data);
      },
      onDrop: () => {
        this.dragContext.endDrag();
        this.isDragging.set(false);
        this.dragEnd.emit();
      },
    });

    this.destroyRef.onDestroy(() => cleanup());
  }
}
