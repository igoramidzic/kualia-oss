import { Directive, ElementRef, EventEmitter, inject, Input, OnDestroy, OnInit, Output } from '@angular/core';

/**
 * Reusable infinite scroll directive using scroll events.
 * Emits an event when the user scrolls near the end of the container.
 *
 * @example
 * ```html
 * <div
 *   appInfiniteScroll
 *   [threshold]="0.8"
 *   [disabled]="loading() || !hasMore()"
 *   (scrolled)="loadMore()"
 * >
 *   <!-- Your content here -->
 * </div>
 * ```
 */
@Directive({
  selector: '[appInfiniteScroll]',
  standalone: true,
})
export class InfiniteScrollDirective implements OnInit, OnDestroy {
  private readonly el = inject(ElementRef);
  private scrollListener?: () => void;

  /**
   * Threshold percentage (0-1) of the container height from the bottom
   * where the scroll event should trigger. Default is 0.9 (90% scrolled).
   */
  @Input() threshold = 0.9;

  /**
   * Disable the infinite scroll behavior (e.g., when loading or no more data).
   */
  @Input() disabled = false;

  /**
   * Event emitted when user has scrolled to the threshold.
   */
  @Output() scrolled = new EventEmitter<void>();

  ngOnInit() {
    this.setupScrollListener();
  }

  ngOnDestroy() {
    this.cleanup();
  }

  private setupScrollListener() {
    const element = this.el.nativeElement as HTMLElement;

    this.scrollListener = () => {
      if (this.disabled) {
        return;
      }

      const scrollTop = element.scrollTop;
      const scrollHeight = element.scrollHeight;
      const clientHeight = element.clientHeight;

      const scrollPercentage = (scrollTop + clientHeight) / scrollHeight;

      if (scrollPercentage >= this.threshold) {
        this.scrolled.emit();
      }
    };

    element.addEventListener('scroll', this.scrollListener, { passive: true });
  }

  private cleanup() {
    if (this.scrollListener) {
      const element = this.el.nativeElement as HTMLElement;
      element.removeEventListener('scroll', this.scrollListener);
      this.scrollListener = undefined;
    }
  }
}
