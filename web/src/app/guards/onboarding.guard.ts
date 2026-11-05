import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, Router, type CanActivateFn } from '@angular/router';
import { api } from 'convex/_generated/api';
import { from } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { ConvexService } from '../services/convex.service';

/**
 * Get workspaceShortId from route or parent routes
 */
function getWorkspaceShortId(route: ActivatedRouteSnapshot): string | null {
  let current: ActivatedRouteSnapshot | null = route;
  while (current) {
    const id = current.paramMap.get('workspaceShortId');
    if (id) return id;
    current = current.parent;
  }
  return null;
}

export const onboardingGuard: CanActivateFn = (route) => {
  const convexService = inject(ConvexService);
  const router = inject(Router);

  return from(
    new Promise<boolean>((resolve) => {
      if (convexService.isAuthenticated()) {
        resolve(true);
      } else {
        const checkInterval = setInterval(() => {
          if (convexService.isAuthenticated()) {
            clearInterval(checkInterval);
            resolve(true);
          }
        }, 100);
      }
    })
  ).pipe(
    switchMap(async () => {
      try {
        const workspaceShortId = getWorkspaceShortId(route);

        if (!workspaceShortId) {
          return router.createUrlTree(['/workspaces']);
        }

        const workspace = await convexService.getClient().query(api.workspaces.getWorkspaceByShortId, {
          shortId: workspaceShortId,
        });

        if (!workspace) {
          return router.createUrlTree(['/workspaces']);
        }

        if (!workspace.onboardingCompleted) {
          return router.createUrlTree([workspaceShortId, 'onboarding']);
        }

        return true;
      } catch {
        return router.createUrlTree(['/workspaces']);
      }
    })
  );
};
