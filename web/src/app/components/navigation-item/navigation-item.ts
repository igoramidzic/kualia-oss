import { NgClass } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { HlmBadge } from '@spartan-ng/helm/badge';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmSidebarService } from '@spartan-ng/helm/sidebar';
import { NucleoIcon, type NucleoIconData } from '@kualia/icons';
import { filter, map, startWith } from 'rxjs/operators';

@Component({
  selector: 'app-navigation-item',
  imports: [NgClass, RouterLink, HlmBadge, HlmButton, NucleoIcon],
  templateUrl: './navigation-item.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NavigationItemComponent {
  readonly label = input.required<string>();
  readonly route = input.required<string>();
  readonly icon = input.required<NucleoIconData>();
  readonly exactMatch = input<boolean>(true);
  readonly badgeCount = input<number | null>(null);
  readonly badgeText = input<string | null>(null);
  readonly badgeTextPosition = input<'end' | 'inline'>('end');
  readonly badgeTextClass = input<string>('text-muted-foreground');
  readonly alertIcon = input<NucleoIconData | null>(null);

  private readonly router = inject(Router);
  private readonly sidebarService = inject(HlmSidebarService);

  // Convert router events to a signal for reactive updates
  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.router.url),
      startWith(this.router.url)
    ),
    { initialValue: this.router.url }
  );

  readonly displayBadgeCount = computed(() => {
    const count = this.badgeCount();
    if (count === null || count === 0) return null;
    if (count > 99) return '99';
    return count.toString();
  });

  readonly routePath = computed(() => {
    const routeStr = this.route();
    const [path] = routeStr.split('?');
    return path;
  });

  readonly routeQueryParams = computed(() => {
    const routeStr = this.route();
    const [, queryString] = routeStr.split('?');

    if (!queryString) {
      return {};
    }

    const queryParams: Record<string, string> = {};
    queryString.split('&').forEach((param) => {
      const [key, value] = param.split('=');
      if (key && value) {
        queryParams[decodeURIComponent(key)] = decodeURIComponent(value);
      }
    });
    return queryParams;
  });

  readonly isActive = computed(() => {
    const currentUrl = this.currentUrl();
    const route = this.route();

    // Remove query params and fragments from current URL
    const currentPath = currentUrl.split('?')[0].split('#')[0];
    const routePath = route.split('?')[0];

    if (this.exactMatch()) {
      return currentPath === routePath;
    } else {
      return currentPath.startsWith(routePath);
    }
  });

  handleClick() {
    this.sidebarService.setOpenMobile(false);
  }
}
