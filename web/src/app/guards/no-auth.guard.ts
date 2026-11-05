import { inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRouteSnapshot, Router, UrlTree, type CanActivateFn } from '@angular/router';
import { from } from 'rxjs';
import { filter, map, switchMap, take } from 'rxjs/operators';
import { AuthService } from '../services/auth.service';
import { LocalAuthService } from '../services/local-auth.service';

export const noAuthGuard: CanActivateFn = (route) => {
  const authService = inject(AuthService);
  const clerkService = inject(LocalAuthService);
  const router = inject(Router);

  // Convert the loading signal to an observable and wait for it to be false
  return toObservable(clerkService.loading).pipe(
    filter((loading) => !loading), // Wait until loading is false
    take(1), // Take only the first emission where loading is false
    switchMap(() => from(authService.getSession())),
    map((session): boolean | UrlTree => {
      if (!session) {
        return true;
      }

      const redirectUrl = getSafeRedirectUrl(route);
      return redirectUrl ? router.parseUrl(redirectUrl) : router.createUrlTree(['/']);
    })
  );
};

function getSafeRedirectUrl(route: ActivatedRouteSnapshot): string | null {
  const redirectUrl = route.queryParamMap.get('redirect')?.trim();
  if (!redirectUrl) {
    return null;
  }

  return redirectUrl.startsWith('/') && !redirectUrl.startsWith('//') ? redirectUrl : null;
}
