import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { HlmButton } from '@spartan-ng/helm/button';
import { nucleoChevronDown as ChevronDown, NucleoIcon } from '@kualia/icons';
import { api } from '../../../../../convex/_generated/api';
import { Id } from '../../../../../convex/_generated/dataModel';
import { ConvexService } from '../../services/convex.service';
import { WorkspaceService } from '../../services/workspace.service';
import { getShortId } from '../../shared/utils/id-utils';
import {
  HlmDropdownMenu,
  HlmDropdownMenuItem,
  HlmDropdownMenuSeparator,
  HlmDropdownMenuTrigger,
} from '../../ui/dropdown-menu/src';

type Workspace = {
  _id: string;
  _creationTime: number;
  name: string;
  role: string;
};

@Component({
  selector: 'app-sidebar-workspace-dropdown',
  imports: [
    RouterLink,
    HlmButton,
    NucleoIcon,
    HlmDropdownMenuTrigger,
    HlmDropdownMenu,
    HlmDropdownMenuItem,
    HlmDropdownMenuSeparator,
  ],
  templateUrl: './sidebar-workspace-dropdown.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SidebarWorkspaceDropdownComponent {
  protected readonly ChevronDown = ChevronDown;
  private readonly convexService = inject(ConvexService);
  private readonly workspaceService = inject(WorkspaceService);
  private readonly router = inject(Router);

  protected readonly workspaces = signal<Workspace[]>([]);
  protected readonly loadingWorkspaces = signal(false);
  protected readonly loadingWorkspaceId = signal<string | null>(null);
  protected readonly workspaceName = computed(() => this.workspaceService.workspace()?.name ?? 'Workspace');

  constructor() {
    void this.loadWorkspaces();
  }

  protected async selectWorkspace(workspace: Workspace): Promise<void> {
    if (this.loadingWorkspaceId() !== null || workspace._id === this.workspaceService.workspaceId()) {
      return;
    }

    this.loadingWorkspaceId.set(workspace._id);

    try {
      await this.convexService.mutation(api.workspaces.updateActiveWorkspace, {
        workspaceId: workspace._id as Id<'workspace'>,
      });
      await this.router.navigate([getShortId(workspace._id)]);
    } catch (error: unknown) {
      console.error('Error selecting workspace:', error);
    } finally {
      this.loadingWorkspaceId.set(null);
    }
  }

  protected isCurrentWorkspace(workspaceId: string): boolean {
    return workspaceId === this.workspaceService.workspaceId();
  }

  private async loadWorkspaces(): Promise<void> {
    this.loadingWorkspaces.set(true);

    try {
      while (!this.convexService.isAuthenticated()) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      const workspaces = await this.convexService.getClient().query(api.workspaces.getUserWorkspaces, {});
      this.workspaces.set(workspaces);
    } catch (error: unknown) {
      console.error('Error loading workspaces:', error);
    } finally {
      this.loadingWorkspaces.set(false);
    }
  }
}
