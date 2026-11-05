import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BrnComboboxImports } from '@spartan-ng/brain/combobox';
import { BrnPopoverContent } from '@spartan-ng/brain/popover';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmComboboxImports } from '@spartan-ng/helm/combobox';
import { NucleoIcon, nucleoCategory as Shapes } from '@kualia/icons';
import { IconService } from '../../services/icon.service';

@Component({
  selector: 'app-icon-picker',
  imports: [HlmButton, FormsModule, NucleoIcon, BrnComboboxImports, BrnPopoverContent, HlmComboboxImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-combobox
      sideOffset="5"
      autoFocus="first-tabbable"
      [disabled]="disabled()"
      (stateChanged)="onStateChanged($event)"
    >
      <hlm-combobox-trigger [class]="buttonClass()" [variant]="variant()" [showIcon]="false" [attr.aria-label]="displayText()">
        <span class="flex items-center gap-2">
          @if (selectedIconData()) {
            <nucleo-icon [icon]="selectedIconData()!" [size]="16" class="text-muted-foreground" />
          } @else {
            <nucleo-icon [icon]="placeholderIcon" [size]="16" class="text-muted-foreground" />
          }
        </span>
      </hlm-combobox-trigger>
      <div
        *brnPopoverContent
        hlmComboboxContent
        class="w-[374px] **:data-[slot=input-group]:border-0 **:data-[slot=input-group]:bg-transparent sm:w-[418px]"
      >
        <div class="border-border border-b">
          <hlm-combobox-input
            placeholder="Search icons..."
            [showTrigger]="false"
            (input)="onSearchChange($any($event.target).value)"
            (keydown)="onKeyDown($event)"
          />
        </div>
        <div class="max-h-[400px] overflow-y-auto">
          @if (filteredIcons().length === 0) {
            <div class="text-muted-foreground py-6 text-center text-sm">No icons found.</div>
          } @else {
            <div class="grid grid-cols-[repeat(auto-fit,minmax(40px,40px))] gap-1 p-2">
              @for (iconName of filteredIcons(); track iconName; let iconIdx = $index) {
                @if (getIconData(iconName); as iconData) {
                  <button
                    hlmBtn
                    size="icon"
                    variant="ghost"
                    [class.text-muted-foreground]="!selectedIcon() && focusedIndex() !== iconIdx"
                    [class.bg-accent]="selectedIconName() === iconName || focusedIndex() === iconIdx"
                    [class.border-border]="selectedIconName() === iconName || focusedIndex() === iconIdx"
                    [class.icon-picker-focused]="focusedIndex() === iconIdx"
                    [class.text-foreground]="selectedIconName() === iconName || focusedIndex() === iconIdx"
                    (click)="selectIcon(iconName)"
                    [attr.aria-label]="iconName"
                    [title]="iconName"
                    class="aspect-square transition-none"
                  >
                    <nucleo-icon [icon]="iconData" [size]="16" />
                  </button>
                }
              }
            </div>
          }
        </div>
      </div>
    </hlm-combobox>
  `,
})
export class IconPickerComponent {
  private readonly iconService = inject(IconService);

  readonly selectedIcon = input<string | null>(null);
  readonly disabled = input<boolean>(false);
  readonly variant = input<'outline' | 'ghost'>('outline');
  readonly buttonClass = input<string>('w-fit justify-between text-xs');
  readonly placeholder = input<string>('Select icon');

  readonly iconChange = output<string>();

  readonly popoverOpen = signal<boolean>(false);
  readonly focusedIndex = signal<number>(-1);

  readonly placeholderIcon = Shapes;

  readonly selectedIconName = computed(() => this.iconService.resolveIconName(this.selectedIcon() ?? ''));

  readonly selectedIconData = computed(() => {
    const iconName = this.selectedIcon();
    if (!iconName) return null;
    return this.iconService.getIconByName(iconName);
  });

  readonly displayText = computed(() => {
    const iconName = this.selectedIcon();
    if (!iconName) return this.placeholder();
    return this.formatIconName(iconName);
  });

  readonly filteredIcons = computed(() => {
    return this.iconService.filteredIcons();
  });

  constructor() {
    // Reset focused index when filtered icons change
    effect(
      () => {
        this.filteredIcons();
        this.focusedIndex.set(-1);
      },
      { allowSignalWrites: true }
    );
  }

  onStateChanged(state: 'open' | 'closed'): void {
    this.popoverOpen.set(state === 'open');
    if (state === 'closed') {
      this.iconService.setSearchQuery('');
      this.focusedIndex.set(-1);
    }
  }

  onSearchChange(query: string): void {
    this.iconService.setSearchQuery(query);
  }

  selectIcon(iconName: string): void {
    this.iconChange.emit(iconName);
  }

  getIconData(iconName: string) {
    return this.iconService.getIconByName(iconName);
  }

  onKeyDown(event: KeyboardEvent): void {
    const icons = this.filteredIcons();
    const currentIndex = this.focusedIndex();

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (currentIndex === -1) {
          this.focusedIndex.set(0);
        } else {
          const cols = this.calculateColumns();
          if (currentIndex + cols < icons.length) {
            this.focusedIndex.set(currentIndex + cols);
          }
        }
        break;

      case 'ArrowUp':
        event.preventDefault();
        if (currentIndex > 0) {
          const cols = this.calculateColumns();
          if (currentIndex >= cols) {
            this.focusedIndex.set(currentIndex - cols);
          }
        }
        break;

      case 'ArrowRight':
        event.preventDefault();
        if (currentIndex === -1) {
          this.focusedIndex.set(0);
        } else if (currentIndex < icons.length - 1) {
          this.focusedIndex.set(currentIndex + 1);
        }
        break;

      case 'ArrowLeft':
        event.preventDefault();
        if (currentIndex > 0) {
          this.focusedIndex.set(currentIndex - 1);
        }
        break;

      case 'Enter':
        event.preventDefault();
        if (currentIndex >= 0 && currentIndex < icons.length) {
          this.selectIcon(icons[currentIndex]);
        }
        break;
    }
  }

  private calculateColumns(): number {
    // Calculate number of columns based on container width
    // Each icon is 40px with 4px gap
    const containerWidth = 500; // sm:w-[500px]
    const iconWidth = 40;
    const gap = 4;
    return Math.floor(containerWidth / (iconWidth + gap));
  }

  private formatIconName(name: string): string {
    return name
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
}
