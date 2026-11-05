import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { api } from 'convex/_generated/api';
import { AuthService } from '../services/auth.service';
import { LocalAuthService } from '../services/local-auth.service';
import { ConvexService } from '../services/convex.service';
import { getShortId } from '../shared/utils/id-utils';

const MAX_WAIT_MS = 5000;
const CHECK_INTERVAL_MS = 50;

/**
 * Guard for the root (/) route.
 * If user is not logged in, redirects to /login.
 * If user is logged in, redirects to /user-onboarding, /workspaces, or workspace short ID.
 */
export const rootGuard: CanActivateFn = async () => {
  const authService = inject(AuthService);
  const clerkService = inject(LocalAuthService);
  const convexService = inject(ConvexService);
  const router = inject(Router);

  await waitForClerkToLoad(clerkService);

  const session = await authService.getSession();
  if (!session) {
    return router.createUrlTree(['/login']);
  }

  await waitForConvexAuth(convexService);

  return handleAuthenticatedUser(convexService, router);
};

async function waitForClerkToLoad(clerkService: LocalAuthService): Promise<void> {
  let elapsed = 0;

  while (clerkService.loading() && elapsed < MAX_WAIT_MS) {
    await new Promise((resolve) => setTimeout(resolve, CHECK_INTERVAL_MS));
    elapsed += CHECK_INTERVAL_MS;
  }
}

async function waitForConvexAuth(convexService: ConvexService): Promise<void> {
  let elapsed = 0;

  while (!convexService.isAuthenticated() && elapsed < MAX_WAIT_MS) {
    await new Promise((resolve) => setTimeout(resolve, CHECK_INTERVAL_MS));
    elapsed += CHECK_INTERVAL_MS;
  }
}

async function handleAuthenticatedUser(convexService: ConvexService, router: Router) {
  try {
    await convexService.ensureCurrentUserProfile();
    const userProfile = await convexService.getClient().query(api.userProfiles.getCurrentProfile, {});
    const onboardingCompleted = userProfile?.onboardingCompleted ?? false;

    if (!onboardingCompleted) {
      return router.createUrlTree(['/user-onboarding']);
    }

    const activeWorkspaceId = userProfile?.activeWorkspaceId;
    if (activeWorkspaceId) {
      const shortId = getShortId(activeWorkspaceId);
      return router.createUrlTree([shortId, 'budget']);
    }

    const userWorkspaces = await convexService.getClient().query(api.workspaces.getUserWorkspaces, {});
    if (userWorkspaces.length > 0) {
      return router.createUrlTree(['/workspaces']);
    }

    return router.createUrlTree(['/workspaces']);
  } catch (error: unknown) {
    console.error('Failed to bootstrap the authenticated user profile', error);
    return false;
  }
}
