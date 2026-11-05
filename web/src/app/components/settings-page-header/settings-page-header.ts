import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { nucleoChevronRight as ChevronRight, NucleoIcon } from '@kualia/icons';
import { WorkspaceService } from '../../services/workspace.service';
import { SidebarToggleComponent } from '../sidebar-toggle/sidebar-toggle';

@Component({
  selector: 'app-settings-page-header',
  imports: [RouterLink, SidebarToggleComponent, NucleoIcon],
  templateUrl: './settings-page-header.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsPageHeaderComponent {
  private readonly workspaceService = inject(WorkspaceService);
  private readonly router = inject(Router);

  protected readonly ChevronRight = ChevronRight;

  pageTitle = input.required<string>();

  protected readonly contextName = computed(() => {
    return this.router.url.startsWith('/settings') ? 'Account' : this.workspaceService.workspace()?.name;
  });

  protected readonly contextRoute = computed(() => {
    if (this.router.url.startsWith('/settings')) {
      return '/';
    }
    const workspaceShortId = this.workspaceService.workspaceShortId();
    return workspaceShortId ? `/${workspaceShortId}` : '/';
  });
}
