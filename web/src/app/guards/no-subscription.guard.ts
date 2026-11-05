import { inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Router, type CanActivateFn, type UrlTree } from '@angular/router';
import { catchError, combineLatest, filter, from, of, switchMap, take } from 'rxjs';
import { api } from '../../../../convex/_generated/api';

import { AppAccessService, isBlockedByFamilyOwnerSubscription } from '../services/app-access.service';
import { LocalAuthService } from '../services/local-auth.service';
import { ConvexService } from '../services/convex.service';
import { getShortId } from '../shared/utils/id-utils';

/**
 * Guard that prevents access if user already has an active subscription
 * Redirects to active workspace or /workspaces if subscribed
 *
 * Use this guard on the /subscribe route to prevent subscribed users from accessing it
 */
export const noSubscriptionGuard: CanActivateFn = () => {
  const clerkService = inject(LocalAuthService);
  const appAccessService = inject(AppAccessService);
  const convexService = inject(ConvexService);
  const router = inject(Router);

  // Create observables in injection context
  const loading$ = toObservable(clerkService.loading);
  const user$ = toObservable(clerkService.user);

  // Wait for Clerk to load, then ask Convex for server-owned app access.
  return combineLatest([loading$, user$]).pipe(
    filter(([loading]) => !loading),
    take(1),
    switchMap(([, user]) => {
      if (!user) {
        return of(router.createUrlTree(['/login']));
      }

      return from(appAccessService.refresh()).pipe(
        switchMap((access) => {
          if (access?.hasAppAccess) {
            // User has access, redirect to active workspace or /workspaces.
            return from(getRedirectUrl(convexService, router));
          }

          if (isBlockedByFamilyOwnerSubscription(access)) {
            return of(router.createUrlTree(['/family/subscription-required']));
          }

          // Owner without access, or solo user without access, may subscribe.
          return of(true);
        }),
        catchError(() => of(true))
      );
    })
  );
};

async function getRedirectUrl(convexService: ConvexService, router: Router): Promise<UrlTree> {
  try {
    const userProfile = await convexService.getClient().query(api.userProfiles.getCurrentProfile, {});

    if (userProfile?.activeWorkspaceId) {
      const shortId = getShortId(userProfile.activeWorkspaceId);
      return router.createUrlTree([shortId, 'budget']);
    }
  } catch {
    // Fall through to default
  }

  return router.createUrlTree(['/workspaces']);
}
