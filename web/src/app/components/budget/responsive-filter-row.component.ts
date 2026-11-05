import {
  afterNextRender,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  NgZone,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { HlmButton } from '@spartan-ng/helm/button';
import { nucleoChevronDown as ChevronDown, NucleoIcon, type NucleoIconData } from '@kualia/icons';
import { HlmDropdownMenu, HlmDropdownMenuItem, HlmDropdownMenuTrigger } from '../../ui/dropdown-menu/src';

export interface FilterConfig {
  id: string;
  label: string;
  icon: NucleoIconData;
  queryParams: Record<string, string>;
  isVisible?: boolean;
  isDisabled?: boolean;
  isActive?: boolean;
  isDestructive?: boolean;
  isPrimary?: boolean;
  isWarning?: boolean;
  count?: number;
  showCount?: boolean;
}

@Component({
  selector: 'app-responsive-filter-row',
  imports: [HlmDropdownMenuTrigger, HlmButton, HlmDropdownMenu, HlmDropdownMenuItem, NucleoIcon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div #container [class]="containerClass()">
      <!-- Visible filter buttons -->
      @for (filter of visibleFilters(); track filter.id) {
        <a
          hlmBtn
          variant="ghost"
          size="sm"
          [routerLink]="[]"
          [queryParams]="filter.queryParams"
          [class]="getFilterClasses(filter)"
          [class.pointer-events-none]="filter.isDisabled ?? false"
          [class.opacity-50]="filter.isDisabled ?? false"
        >
          <nucleo-icon [icon]="filter.icon" size="14" />
          {{ filter.label }}
          @if (filter.showCount && filter.count) {
            <span class="font-light">{{ filter.count }}</span>
          }
        </a>
      }

      <!-- More dropdown button -->
      @if (hiddenFilters().length > 0) {
        <button
          hlmBtn
          variant="ghost"
          size="sm"
          type="button"
          hlmDropdownMenuTrigger
          [hlmDropdownMenuTrigger]="moreMenu"
          [class]="getMoreButtonClasses()"
        >
          @if (activeHiddenFilter()) {
            <nucleo-icon [icon]="activeHiddenFilter()!.icon" size="14" />
          }
          {{ moreButtonText() }}
          <nucleo-icon [icon]="ChevronDown" size="14" />
        </button>

        <ng-template #moreMenu>
          <hlm-dropdown-menu class="w-56">
            @for (filter of hiddenFilters(); track filter.id) {
              <button
                hlmDropdownMenuItem
                [routerLink]="[]"
                [queryParams]="filter.queryParams"
                [class.bg-accent]="filter.isActive ?? false"
                [class.text-primary]="(filter.isPrimary ?? false) && (filter.count ?? 0) > 0"
                [class.text-yellow-500]="
                  (filter.isWarning ?? false) && (filter.isActive ?? false) && (filter.count ?? 0) > 0
                "
                [class.text-destructive]="
                  (filter.isDestructive ?? false) &&
                  (filter.count ?? 0) > 0 &&
                  !(filter.isWarning ?? false) &&
                  !(filter.isPrimary ?? false)
                "
                [disabled]="filter.isDisabled ?? false"
                [class.opacity-50]="filter.isDisabled ?? false"
              >
                <div class="flex w-full items-center gap-2">
                  <nucleo-icon [icon]="filter.icon" size="14" />
                  <span>{{ filter.label }}</span>
                  @if (filter.showCount && filter.count) {
                    <span class="font-light">{{ filter.count }}</span>
                  }
                </div>
              </button>
            }
          </hlm-dropdown-menu>
        </ng-template>
      }

      <!-- Hidden measurement container for filter widths -->
      <div #measureContainer class="pointer-events-none invisible absolute top-0 left-0 flex gap-1 whitespace-nowrap">
        @for (filter of allFilters(); track filter.id) {
          <!-- Measure filter button -->
          <span
            #measureButton
            [attr.data-measure-id]="filter.id"
            class="inline-flex h-6 items-center gap-1 border px-2 text-xs"
          >
            <nucleo-icon [icon]="filter.icon" size="14" />
            {{ filter.label }}
            @if (filter.showCount && filter.count) {
              <span class="font-light">{{ filter.count }}</span>
            }
          </span>
          <!-- Measure "more" button when showing this filter's label (icon + label + chevron) -->
          <span
            #measureMoreWithLabel
            [attr.data-more-label-id]="filter.id"
            class="inline-flex h-6 items-center gap-1 border px-2 text-xs"
          >
            <nucleo-icon [icon]="filter.icon" size="14" />
            {{ filter.label }}
            @if (filter.showCount && filter.count) {
              <span class="font-light">{{ filter.count }}</span>
            }
            <nucleo-icon [icon]="ChevronDown" size="14" />
          </span>
        }
        <!-- Measure "X more" button (generic) -->
        <span #measureMoreButton class="inline-flex h-6 items-center gap-1 border px-2 text-xs">
          {{ allFilters().length }} more
          <nucleo-icon [icon]="ChevronDown" size="14" />
        </span>
      </div>
    </div>
  `,
})
export class ResponsiveFilterRowComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly ngZone = inject(NgZone);
  private readonly cdr = inject(ChangeDetectorRef);

  readonly filters = input.required<FilterConfig[]>();
  readonly containerClass = input<string>(
    'flex h-10 w-full min-w-0 items-center gap-1 overflow-hidden border-t px-1.5 py-1 sm:px-3'
  );

  readonly ChevronDown = ChevronDown;

  readonly container = viewChild<ElementRef<HTMLDivElement>>('container');
  readonly measureButtons = viewChildren<ElementRef<HTMLSpanElement>>('measureButton');
  readonly measureMoreWithLabels = viewChildren<ElementRef<HTMLSpanElement>>('measureMoreWithLabel');
  readonly measureMoreButton = viewChild<ElementRef<HTMLSpanElement>>('measureMoreButton');

  // All filters that should be shown (filtered by visibility)
  readonly allFilters = computed<FilterConfig[]>(() => {
    return this.filters().filter((f) => f.isVisible !== false);
  });

  // Number of filters to hide (computed from container width)
  private readonly hiddenCount = signal(0);

  // Visible filters (first N filters that fit)
  readonly visibleFilters = computed(() => {
    const all = this.allFilters();
    const hideCount = this.hiddenCount();
    if (hideCount === 0) return all;
    return all.slice(0, all.length - hideCount);
  });

  // Hidden filters (last N filters that don't fit)
  readonly hiddenFilters = computed(() => {
    const all = this.allFilters();
    const hideCount = this.hiddenCount();
    if (hideCount === 0) return [];
    return all.slice(all.length - hideCount);
  });

  // Active filter if it's in the hidden list
  readonly activeHiddenFilter = computed(() => {
    return this.hiddenFilters().find((f) => f.isActive === true) ?? null;
  });

  // Text for the "more" button
  readonly moreButtonText = computed(() => {
    const activeHidden = this.activeHiddenFilter();
    if (activeHidden) return activeHidden.label;
    return `${this.hiddenFilters().length} more`;
  });

  private resizeObserver: ResizeObserver | null = null;
  private filterWidths = new Map<string, number>();
  private moreButtonWidthGeneric = 0; // Width for "X more" text
  private moreButtonWidthByFilter = new Map<string, number>(); // Width when showing filter label
  private containerPadding = 0;
  private gap = 4;
  private initialized = false;
  private isDestroyed = false;

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.isDestroyed = true;
      this.resizeObserver?.disconnect();
      this.resizeObserver = null;
    });

    afterNextRender(() => {
      // Measure filter widths after first render
      requestAnimationFrame(() => {
        if (this.isDestroyed) return;

        this.ngZone.run(() => {
          this.measureFilterWidths();
          this.calculateLayout();
          this.setupResizeObserver();
          this.initialized = true;
        });
      });
    });

    // Re-measure and recalculate when filters change (e.g., overspent count changes)
    effect(() => {
      // Track allFilters to trigger on changes
      this.allFilters();

      // Only run after initial setup
      if (this.initialized) {
        requestAnimationFrame(() => {
          if (this.isDestroyed) return;

          this.ngZone.run(() => {
            this.measureFilterWidths();
            this.calculateLayout();
          });
        });
      }
    });
  }

  getFilterClasses(filter: FilterConfig): string {
    const classes = ['h-6', 'shrink-0', 'border', 'px-2', 'text-xs', 'border-border'];
    const isActive = filter.isActive ?? false;
    const isDestructive = filter.isDestructive ?? false;
    const isPrimary = filter.isPrimary ?? false;
    const isWarning = filter.isWarning ?? false;
    const hasCount = (filter.count ?? 0) > 0;

    if (isActive) {
      classes.push('bg-accent/50');
    }

    // Primary state takes precedence over other states
    if (isPrimary && hasCount) {
      classes.push('text-primary', 'hover:text-primary');
    } else if (isWarning && hasCount) {
      // Warning state (yellow color) - only show when active, otherwise muted with hover
      if (isActive) {
        classes.push('text-yellow-500', 'hover:text-yellow-500');
      } else {
        classes.push('text-muted-foreground/80', 'hover:text-yellow-500');
      }
    } else if (isDestructive && hasCount) {
      classes.push('text-destructive', 'hover:text-destructive');
    } else {
      classes.push('hover:text-foreground');
      if (!isActive) {
        classes.push('text-muted-foreground/80');
      }
    }

    return classes.join(' ');
  }

  getMoreButtonClasses(): string {
    const classes = ['h-6', 'shrink-0', 'border', 'border-border', 'px-2', 'text-xs'];

    const activeHidden = this.activeHiddenFilter();
    if (activeHidden) {
      classes.push('bg-accent/50');
      const hasCount = (activeHidden.count ?? 0) > 0;

      // Primary state takes precedence
      if ((activeHidden.isPrimary ?? false) && hasCount) {
        classes.push('text-primary', 'hover:text-primary');
      } else if ((activeHidden.isWarning ?? false) && hasCount) {
        // Warning state (yellow color)
        classes.push('text-yellow-500', 'hover:text-yellow-500');
      } else if ((activeHidden.isDestructive ?? false) && hasCount) {
        classes.push('text-destructive', 'hover:text-destructive');
      } else {
        classes.push('text-muted-foreground/80', 'hover:text-foreground');
      }
    } else {
      classes.push('text-muted-foreground/80', 'hover:text-foreground');
    }

    return classes.join(' ');
  }

  private measureFilterWidths(): void {
    const measureButtons = this.measureButtons();
    const measureMoreWithLabels = this.measureMoreWithLabels();
    const measureMore = this.measureMoreButton()?.nativeElement;
    const containerEl = this.container()?.nativeElement;

    if (!containerEl) return;

    // Get container styles
    const computedStyle = window.getComputedStyle(containerEl);
    this.containerPadding = parseFloat(computedStyle.paddingLeft) + parseFloat(computedStyle.paddingRight);
    this.gap = parseFloat(computedStyle.gap) || 4;

    // Measure each filter button
    this.filterWidths.clear();
    measureButtons.forEach((button) => {
      const el = button.nativeElement;
      const filterId = el.getAttribute('data-measure-id');
      if (filterId) {
        this.filterWidths.set(filterId, el.offsetWidth);
      }
    });

    // Measure "more" button when showing each filter's label
    this.moreButtonWidthByFilter.clear();
    measureMoreWithLabels.forEach((button) => {
      const el = button.nativeElement;
      const filterId = el.getAttribute('data-more-label-id');
      if (filterId) {
        this.moreButtonWidthByFilter.set(filterId, el.offsetWidth);
      }
    });

    // Measure generic "X more" button
    if (measureMore) {
      this.moreButtonWidthGeneric = measureMore.offsetWidth;
    }
  }

  private setupResizeObserver(): void {
    if (this.isDestroyed || this.resizeObserver) return;

    const containerEl = this.container()?.nativeElement;
    if (!containerEl) return;

    // ResizeObserver may not be available in test environments (jsdom)
    if (typeof ResizeObserver === 'undefined') return;

    this.resizeObserver = new ResizeObserver(() => {
      this.ngZone.run(() => {
        // Re-measure widths on resize in case component was initially hidden
        this.measureFilterWidths();
        this.calculateLayout();
      });
    });

    this.resizeObserver.observe(containerEl);
  }

  private calculateLayout(): void {
    const containerEl = this.container()?.nativeElement;
    if (!containerEl) return;

    // Skip if container is hidden (has no width)
    if (containerEl.clientWidth === 0) return;

    // Subtract buffer to collapse slightly before buttons hit the edge
    const availableWidth = containerEl.clientWidth - this.containerPadding - 8;
    const filters = this.allFilters();

    if (filters.length === 0) {
      this.hiddenCount.set(0);
      this.cdr.markForCheck();
      return;
    }

    // Find the active filter
    const activeFilter = filters.find((f) => f.isActive);
    const activeFilterId = activeFilter?.id;
    const activeFilterIndex = activeFilter ? filters.indexOf(activeFilter) : -1;

    // Calculate visible count with a given more button width
    const calculateVisibleCount = (moreButtonWidth: number): number => {
      let totalWidth = 0;
      let count = 0;

      for (let i = 0; i < filters.length; i++) {
        const filter = filters[i];
        const filterWidth = this.filterWidths.get(filter.id) ?? 80;
        const widthWithGap = i === 0 ? filterWidth : filterWidth + this.gap;

        // Check if remaining filters need "more" button
        const remainingFilters = filters.length - i - 1;
        const needsMoreButton = remainingFilters > 0;
        const moreButtonSpace = needsMoreButton ? moreButtonWidth + this.gap : 0;

        // Would adding this filter overflow?
        if (totalWidth + widthWithGap + moreButtonSpace <= availableWidth) {
          totalWidth += widthWithGap;
          count++;
        } else {
          // This filter doesn't fit
          // Make sure we have room for the "more" button with current visible filters
          const spaceWithMoreButton = totalWidth + moreButtonWidth + this.gap;
          if (spaceWithMoreButton > availableWidth && count > 0) {
            count--;
          }
          break;
        }
      }

      return Math.max(1, Math.min(count, filters.length));
    };

    // First pass: calculate with generic "X more" width
    let visibleCount = calculateVisibleCount(this.moreButtonWidthGeneric);
    let hiddenCount = filters.length - visibleCount;

    // Check if the active filter would be hidden
    if (hiddenCount > 0 && activeFilterIndex >= 0 && activeFilterIndex >= visibleCount && activeFilterId) {
      // The active filter will be hidden, so the more button will show its label
      // Recalculate using the active filter's label width
      const activeFilterMoreWidth = this.moreButtonWidthByFilter.get(activeFilterId) ?? this.moreButtonWidthGeneric;
      visibleCount = calculateVisibleCount(activeFilterMoreWidth);
      hiddenCount = filters.length - visibleCount;
    }

    this.hiddenCount.set(hiddenCount);
    this.cdr.markForCheck();
  }
}
