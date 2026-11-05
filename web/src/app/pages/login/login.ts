import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmInput } from '@spartan-ng/helm/input';
import { AuthService } from '../../services/auth.service';

export function safeAuthRedirect(value: string | null): string {
  return value?.startsWith('/') && !value.startsWith('//') && !value.includes('\\') ? value : '/';
}

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, RouterLink, HlmButton, HlmInput],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected readonly signingUp = this.route.snapshot.routeConfig?.path === 'signup';
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly form = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(this.signingUp ? 12 : 1)]],
  });

  protected async submit(): Promise<void> {
    if (this.form.invalid || this.loading()) {
      this.form.markAllAsTouched();
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    try {
      const { email, password } = this.form.getRawValue();
      const result = await this.auth.signInWithPassword(email, password, this.signingUp ? 'signUp' : 'signIn');
      if (!result.success) {
        this.error.set(result.error ?? 'Unable to sign in.');
        return;
      }
      await this.router.navigateByUrl(safeAuthRedirect(this.route.snapshot.queryParamMap.get('redirect')));
    } finally {
      this.loading.set(false);
    }
  }
}
