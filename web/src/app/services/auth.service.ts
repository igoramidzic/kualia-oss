import { inject, Injectable } from '@angular/core';
import { LocalAuthService } from './local-auth.service';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly auth = inject(LocalAuthService);
  readonly user = this.auth.user;
  readonly loading = this.auth.loading;
  readonly error = this.auth.error;
  readonly session = this.auth.session;
  readonly isAuthenticated = this.auth.isAuthenticated;
  signInWithPassword(email: string, password: string, flow: 'signIn' | 'signUp') {
    return this.auth.signInWithPassword(email, password, flow);
  }
  getCurrentUser() {
    return this.auth.getCurrentUser();
  }
  getSession() {
    return this.auth.getSession();
  }
  logout() {
    return this.auth.logout();
  }
  clearError() {
    this.auth.clearError();
  }
}
