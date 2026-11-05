import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { HlmBadge } from '@spartan-ng/helm/badge';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCard } from '@spartan-ng/helm/card';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';
import { api } from 'convex/_generated/api';
import { FunctionReturnType } from 'convex/server';
import { toast } from 'ngx-sonner';
import { DeleteAccountDialogComponent } from '../../../components/dialogs/delete-account-dialog/delete-account-dialog';
import { SettingsPageHeaderComponent } from '../../../components/settings-page-header/settings-page-header';
import { AuthService } from '../../../services/auth.service';
import { ConvexService } from '../../../services/convex.service';

type UserProfile = FunctionReturnType<typeof api.userProfiles.getCurrentProfile>;

@Component({
  selector: 'app-profile',
  imports: [HlmBadge, HlmButton, HlmCard, HlmInput, HlmLabel, SettingsPageHeaderComponent],
  templateUrl: './profile.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block h-full',
  },
})
export class ProfileComponent {
  private readonly authService = inject(AuthService);
  private readonly convexService = inject(ConvexService);
  private readonly dialogService = inject(HlmDialogService);

  protected readonly name = signal('');
  protected readonly nameTouched = signal(false);
  protected readonly saving = signal(false);
  private readonly initialName = signal('');
  private readonly userProfileQuery = this.convexService.query<UserProfile>(api.userProfiles.getCurrentProfile, {});

  protected readonly user = computed(() => this.authService.user());
  protected readonly userProfile = computed(() => this.userProfileQuery() ?? null);
  protected readonly email = computed(() => this.userProfile()?.email ?? this.user()?.email ?? 'No email on file');
  protected readonly authProviderLabel = computed(() => this.user()?.authProviderLabel ?? 'Email');
  protected readonly normalizedName = computed(() => this.normalizeName(this.name()));
  protected readonly nameError = computed(() => {
    if (!this.nameTouched() || this.normalizedName().length > 0) {
      return null;
    }

    return 'Required';
  });

  constructor() {
    effect(() => {
      const userProfile = this.userProfileQuery();
      if (userProfile === undefined) {
        return;
      }

      const currentName = this.normalizeName(userProfile?.name ?? '');
      this.initialName.set(currentName);
      this.name.set(currentName);
      this.nameTouched.set(false);
    });
  }

  protected onNameInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.name.set(input.value);
  }

  protected onNameSubmit(event: Event): void {
    event.preventDefault();
    const input = event.target as HTMLInputElement;
    this.name.set(input.value);
    input.blur();
  }

  protected async onNameBlur(): Promise<void> {
    this.nameTouched.set(true);

    if (this.normalizedName().length === 0 || this.normalizedName() === this.initialName() || this.saving()) {
      return;
    }

    const name = this.normalizedName();
    this.saving.set(true);

    try {
      await this.convexService.mutation(api.userProfiles.updateProfile, { name });
      this.name.set(name);
      this.initialName.set(name);
      this.nameTouched.set(false);
      toast.success('Profile saved');
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Failed to update profile');
    } finally {
      this.saving.set(false);
    }
  }

  protected openDeleteAccountDialog(): void {
    this.dialogService.open(DeleteAccountDialogComponent, {
      contentClass: 'sm:max-w-[500px]',
    });
  }

  private normalizeName(name: string): string {
    return name.trim().replace(/\s+/g, ' ');
  }
}
