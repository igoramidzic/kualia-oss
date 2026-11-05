import { inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Router, UrlTree, type CanActivateFn } from '@angular/router';
import { from, of } from 'rxjs';
import { catchError, filter, map, switchMap, take } from 'rxjs/operators';
import { LocalAuthService } from '../services/local-auth.service';
import { ConvexService } from '../services/convex.service';

export const authGuard: CanActivateFn = (route, state) => {
  const clerkService = inject(LocalAuthService);
  const convexService = inject(ConvexService);
  const router = inject(Router);

  // Convert the loading signal to an observable and wait for it to be false
  return toObservable(clerkService.loading).pipe(
    filter((loading) => !loading), // Wait until loading is false
    take(1), // Take only the first emission where loading is false
    switchMap(() => {
      // Check authentication synchronously using the signal
      const isAuthenticated = clerkService.isAuthenticated();

      if (!isAuthenticated) {
        return of(
          router.createUrlTree(['/login'], {
            queryParams: { redirect: state.url },
          })
        );
      }

      return from(convexService.ensureCurrentUserProfile()).pipe(
        map((): boolean | UrlTree => true),
        catchError((error: unknown) => {
          console.error('Failed to bootstrap the authenticated user profile', error);
          return of(false);
        })
      );
    })
  );
};
