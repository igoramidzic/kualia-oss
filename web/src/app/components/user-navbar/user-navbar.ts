import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { nucleoChevronDown as ChevronDown, NucleoIcon } from '@kualia/icons';
import { AuthService } from '../../services/auth.service';
import { HlmDropdownMenu, HlmDropdownMenuItem, HlmDropdownMenuTrigger } from '../../ui/dropdown-menu/src';

@Component({
  selector: 'app-user-navbar',
  imports: [NucleoIcon, HlmDropdownMenuTrigger, HlmButton, HlmDropdownMenu, HlmDropdownMenuItem],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './user-navbar.html',
})
export class UserNavbarComponent {
  private readonly authService = inject(AuthService);

  readonly ChevronDown = ChevronDown;
  readonly userEmail = computed(() => this.authService.user()?.email ?? 'User');
  readonly userInitials = computed(() => {
    const email = this.userEmail();
    if (!email || email === 'User') return 'U';
    return email
      .split('@')[0]
      .split('.')
      .map((part) => part[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  });

  async logout(): Promise<void> {
    await this.authService.logout();
  }
}
