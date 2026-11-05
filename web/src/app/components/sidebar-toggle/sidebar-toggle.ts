import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmSidebarService } from '@spartan-ng/helm/sidebar';
import { NucleoIcon, nucleoSidebarLeftOpen as PanelLeftOpen } from '@kualia/icons';

@Component({
  selector: 'app-sidebar-toggle',
  imports: [NucleoIcon, HlmButton],
  template: `
    <button
      hlmBtn
      class="text-muted-foreground h-8 w-8 rounded-full"
      variant="outline"
      size="icon"
      aria-label="Open sidebar"
      (click)="toggle()"
    >
      <nucleo-icon [icon]="openIcon" [size]="16" />
    </button>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SidebarToggleComponent {
  protected readonly openIcon = PanelLeftOpen;
  private readonly sidebarService = inject(HlmSidebarService);

  toggle(): void {
    this.sidebarService.toggleSidebar();
  }
}
