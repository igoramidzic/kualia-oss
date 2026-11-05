import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HlmButton } from '@spartan-ng/helm/button';
import type { FunctionReturnType } from 'convex/server';
import {
  nucleoChevronDown as ChevronDown,
  nucleoLogout as LogOut,
  NucleoIcon,
  nucleoPreferences as Settings,
  nucleoUser as UserIcon,
} from '@kualia/icons';
import { api } from '../../../../../convex/_generated/api';
import { AuthService } from '../../services/auth.service';
import { ConvexService } from '../../services/convex.service';
import { HlmAvatar, HlmAvatarFallback, HlmAvatarImage } from '../../ui/avatar/src';
import {
  HlmDropdownMenu,
  HlmDropdownMenuItem,
  HlmDropdownMenuSeparator,
  HlmDropdownMenuTrigger,
} from '../../ui/dropdown-menu/src';

type UserProfile = FunctionReturnType<typeof api.userProfiles.getCurrentProfile>;

@Component({
  selector: 'app-sidebar-organization-dropdown',
  imports: [
    RouterLink,
    HlmButton,
    HlmAvatar,
    HlmAvatarFallback,
    HlmAvatarImage,
    NucleoIcon,
    HlmDropdownMenuTrigger,
    HlmDropdownMenu,
    HlmDropdownMenuItem,
    HlmDropdownMenuSeparator,
  ],
  templateUrl: './sidebar-organization-dropdown.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SidebarOrganizationDropdownComponent {
  protected readonly Settings = Settings;
  protected readonly ChevronDown = ChevronDown;
  protected readonly LogOut = LogOut;
  protected readonly UserIcon = UserIcon;

  readonly iconOnly = input(false);

  protected readonly authService = inject(AuthService);
  private readonly convexService = inject(ConvexService);
  private readonly userProfileQuery = this.convexService.query<UserProfile>(api.userProfiles.getCurrentProfile, {});

  protected readonly userDisplayName = computed(() => {
    const name = this.userProfileQuery()?.name?.trim();
    return name && name.length > 0 ? name : 'User';
  });

  protected readonly userImageUrl = computed(() => this.authService.user()?.imageUrl ?? null);

  protected readonly triggerSize = computed(() => (this.iconOnly() ? 'icon' : 'sm'));
  protected readonly triggerVariant = computed(() => (this.iconOnly() ? 'outline' : 'ghost'));
  protected readonly triggerClass = computed(() =>
    this.iconOnly() ? 'text-muted-foreground h-8 w-8 rounded-full p-0' : 'w-full justify-start px-2 py-1.5 text-sm'
  );
  protected readonly menuSide = computed(() => (this.iconOnly() ? 'right' : 'top'));

  protected readonly settingsLink = '/settings';

  protected async logout() {
    await this.authService.logout();
  }
}
