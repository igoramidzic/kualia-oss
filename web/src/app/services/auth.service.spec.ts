import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthService } from './auth.service';
import { LocalAuthService } from './local-auth.service';

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(() => {
    const user = signal({
      id: 'user_123',
      email: 'igor@example.com',
      name: 'Igor Amidzic',
      authProviderLabel: 'Google',
      emailVerified: true,
      createdAt: null,
      updatedAt: null,
    });

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        AuthService,
        {
          provide: LocalAuthService,
          useValue: {
            user: user.asReadonly(),
            loading: signal(false).asReadonly(),
            error: signal(null).asReadonly(),
            session: signal(null).asReadonly(),
            isAuthenticated: signal(true).asReadonly(),
          },
        },
      ],
    });

    service = TestBed.inject(AuthService);
  });

  it('exposes auth fields from LocalAuthService', () => {
    expect(service.user()?.authProviderLabel).toBe('Google');
    expect(service.user()?.email).toBe('igor@example.com');
  });
});
