import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { NucleoIcon, nucleoShop as Store } from '@kualia/icons';
import { IconService } from '../../services/icon.service';
import {
  DEFAULT_MERCHANT_ICON_NAME,
  EntityIconColorId,
  VisualIdentityMode,
  getEntityIconColor,
} from '../../shared/utils/entity-identity';

type EntityMarkSize = 'xxs' | 'xs' | 'sm' | 'md' | 'lg';

@Component({
  selector: 'app-entity-mark',
  imports: [NucleoIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (shouldRenderIcon()) {
      <div
        [class]="containerClass()"
        [style.background-color]="iconColor().background"
        [style.color]="iconColor().foreground"
        [attr.aria-label]="alt()"
      >
        <nucleo-icon [icon]="iconData()" [size]="iconSize()" />
      </div>
    } @else if (logoUrl()) {
      <img [src]="logoUrl()!" [alt]="alt()" [class]="imageClass()" />
    } @else {
      <div [class]="fallbackClass()">
        <nucleo-icon [icon]="fallbackIconData()" [size]="iconSize()" />
      </div>
    }
  `,
})
export class EntityMarkComponent {
  private readonly iconService = inject(IconService);

  readonly mode = input<VisualIdentityMode | null | undefined>('logo');
  readonly logoUrl = input<string | null | undefined>(undefined);
  readonly iconName = input<string | null | undefined>(undefined);
  readonly iconColorId = input<EntityIconColorId | null | undefined>(undefined);
  readonly defaultIconName = input<string>(DEFAULT_MERCHANT_ICON_NAME);
  readonly alt = input<string>('Entity');
  readonly size = input<EntityMarkSize>('md');

  protected readonly shouldRenderIcon = computed(() => this.mode() === 'icon');
  protected readonly iconColor = computed(() => getEntityIconColor(this.iconColorId()));
  protected readonly iconData = computed(() => {
    const selectedIconName = this.iconName() ?? this.defaultIconName();
    return this.iconService.getIconByName(selectedIconName) ?? this.fallbackIconData();
  });
  protected readonly fallbackIconData = computed(() => this.iconService.getIconByName(this.defaultIconName()) ?? Store);
  protected readonly iconSize = computed(() => {
    switch (this.size()) {
      case 'xxs':
        return 10;
      case 'xs':
        return 12;
      case 'sm':
        return 14;
      case 'lg':
        return 22;
      case 'md':
        return 18;
    }
  });
  protected readonly containerClass = computed(() => {
    return `${this.baseSizeClass()} flex flex-shrink-0 items-center justify-center rounded-full transition-opacity select-none`;
  });
  protected readonly imageClass = computed(() => {
    return `${this.baseSizeClass()} flex-shrink-0 rounded-full object-contain transition-opacity`;
  });
  protected readonly fallbackClass = computed(() => {
    return `${this.baseSizeClass()} bg-accent/50 text-muted-foreground flex flex-shrink-0 items-center justify-center rounded-full border transition-opacity select-none`;
  });

  private baseSizeClass(): string {
    switch (this.size()) {
      case 'xxs':
        return 'h-4 w-4';
      case 'xs':
        return 'h-5 w-5';
      case 'sm':
        return 'h-7 w-7';
      case 'lg':
        return 'h-12 w-12';
      case 'md':
        return 'h-10 w-10';
    }
  }
}
