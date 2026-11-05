import { inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Router, type CanActivateFn, type UrlTree } from '@angular/router';
import { api } from 'convex/_generated/api';
import { combineLatest, filter, from, switchMap, take } from 'rxjs';

import { LocalAuthService } from '../services/local-auth.service';
import { ConvexService } from '../services/convex.service';

/**
 * Guard that allows access to /user-onboarding only if user hasn't completed onboarding.
 * Redirects to /subscribe if onboarding is already completed.
 *
 * Use this guard on the /user-onboarding route.
 */
export const userOnboardingGuard: CanActivateFn = () => {
  const clerkService = inject(LocalAuthService);
  const convexService = inject(ConvexService);
  const router = inject(Router);

  const loading$ = toObservable(clerkService.loading);
  const session$ = toObservable(clerkService.session);

  return combineLatest([loading$, session$]).pipe(
    filter(([loading, session]) => !loading && !!session),
    take(1),
    switchMap(() => from(checkOnboardingStatus(convexService, router)))
  );
};

async function checkOnboardingStatus(convexService: ConvexService, router: Router): Promise<boolean | UrlTree> {
  await convexService.ensureCurrentUserProfile();
  const profile = await convexService.getClient().query(api.userProfiles.getCurrentProfile, {});

  if (!profile) {
    return false;
  }

  if (profile.onboardingCompleted) {
    return router.createUrlTree(['/subscribe']);
  }

  return true;
}
