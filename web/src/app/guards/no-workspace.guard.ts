import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { api } from 'convex/_generated/api';
import { ConvexService } from '../services/convex.service';
import { getShortId } from '../shared/utils/id-utils';

/**
 * Guard that only allows access if the user doesn't have a workspace.
 * If the user has a workspace, redirects to the workspace or workspace selection page.
 */
export const noWorkspaceGuard: CanActivateFn = async () => {
  const convexService = inject(ConvexService);
  const router = inject(Router);

  // Wait for authentication to be ready
  while (!convexService.isAuthenticated()) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  try {
    // Check if user has any workspaces
    const userWorkspaces = await convexService.getClient().query(api.workspaces.getUserWorkspaces, {});

    if (userWorkspaces.length > 0) {
      // User has workspaces, check for active workspace
      const userProfile = await convexService.getClient().query(api.userProfiles.getCurrentProfile, {});
      if (userProfile?.activeWorkspaceId) {
        // User has active workspace, redirect to it
        const shortId = getShortId(userProfile.activeWorkspaceId);
        return router.createUrlTree([shortId]);
      } else {
        // User has workspaces but no active one, redirect to selection
        return router.createUrlTree(['/workspaces']);
      }
    }

    // User doesn't have any workspaces, allow access to join page
    return true;
  } catch {
    // On error, allow access (let join page handle it)
    return true;
  }
};
