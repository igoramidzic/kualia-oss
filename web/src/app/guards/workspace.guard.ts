import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, Router, type CanActivateFn } from '@angular/router';
import { WorkspaceService } from '../services/workspace.service';

/**
 * Lightweight guard that extracts workspace short ID from URL and triggers data fetching.
 * NOTE: This guard runs AFTER authGuard, so authentication is already confirmed.
 * Workspace validation and data fetching happens in the background via WorkspaceService.
 */
export const workspaceGuard: CanActivateFn = (route: ActivatedRouteSnapshot) => {
  const workspaceService = inject(WorkspaceService);
  const router = inject(Router);

  // Get the workspace short ID from the route
  const workspaceShortId = route.paramMap.get('workspaceShortId');

  if (!workspaceShortId) {
    return router.createUrlTree(['/workspaces']);
  }

  // Set the short ID - WorkspaceService will fetch and validate in the background
  workspaceService.setWorkspaceShortId(workspaceShortId);

  // Allow navigation immediately - data fetching happens in the background
  return true;
};
