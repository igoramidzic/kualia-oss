import { inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Router, type CanActivateFn, type UrlTree } from '@angular/router';
import { catchError, combineLatest, filter, from, map, of, switchMap, take } from 'rxjs';

import { AppAccessService, isBlockedByFamilyOwnerSubscription } from '../services/app-access.service';
import { LocalAuthService } from '../services/local-auth.service';

/**
 * Guard that checks if the user has an active subscription
 * Redirects to /subscribe if not subscribed
 *
 * This guard should be used AFTER authGuard in the route configuration
 * to ensure the user is authenticated before checking subscription
 */
export const subscriptionGuard: CanActivateFn = () => {
  const clerkService = inject(LocalAuthService);
  const appAccessService = inject(AppAccessService);
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
        map((access): boolean | UrlTree => {
          if (access?.hasAppAccess) {
            return true;
          }

          if (isBlockedByFamilyOwnerSubscription(access)) {
            return router.createUrlTree(['/family/subscription-required']);
          }

          return router.createUrlTree(['/subscribe']);
        }),
        catchError(() => of(router.createUrlTree(['/subscribe'])))
      );
    })
  );
};
