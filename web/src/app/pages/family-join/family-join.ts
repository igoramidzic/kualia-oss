import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCard } from '@spartan-ng/helm/card';
import { api } from 'convex/_generated/api';
import { FunctionReturnType } from 'convex/server';
import { ConvexError } from 'convex/values';
import {
  nucleoWarningCircle as AlertCircle,
  nucleoArrowRight as ArrowRight,
  nucleoCheckCircle as CheckCircle2,
  nucleoLoader as LoaderCircle,
  NucleoIcon,
  nucleoEmail as Mail,
  nucleoUsers as UsersRound,
} from '@kualia/icons';
import { toast } from 'ngx-sonner';
import { UserNavbarComponent } from '../../components/user-navbar/user-navbar';
import { ConvexService } from '../../services/convex.service';

type FamilyGroupInvitePreview = FunctionReturnType<typeof api.familyGroups.getInvitePreview>;

const BACKEND_AUTH_WAIT_MS = 10000;
const PROFILE_RETRY_WAIT_MS = 10000;
const WAIT_INTERVAL_MS = 100;

@Component({
  selector: 'app-family-join',
  imports: [RouterLink, HlmButton, HlmCard, NucleoIcon, UserNavbarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bg-background flex h-screen flex-col overflow-hidden select-none">
      <app-user-navbar />

      <main class="flex-1 overflow-auto px-4 py-8">
        <div class="mx-auto flex min-h-full w-full max-w-xl items-start justify-center sm:items-center">
          <div class="w-full">
            @if (loading()) {
              <div hlmCard class="flex min-h-[280px] items-center justify-center p-6">
                <div class="text-muted-foreground flex items-center gap-2 text-sm">
                  <nucleo-icon [icon]="LoaderCircle" class="h-4 w-4 animate-spin" />
                  Loading family invite...
                </div>
              </div>
            } @else if (errorMessage()) {
              <div hlmCard class="p-6">
                <div class="flex items-start gap-4">
                  <div
                    class="bg-destructive/10 text-destructive flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-md"
                  >
                    <nucleo-icon [icon]="AlertCircle" class="h-5 w-5" />
                  </div>
                  <div class="min-w-0 flex-1">
                    <h1 class="text-xl font-medium">Family invite unavailable</h1>
                    <p class="text-muted-foreground mt-2 text-sm leading-6">{{ errorMessage() }}</p>
                  </div>
                </div>

                <div class="mt-6 flex justify-end">
                  <a hlmBtn variant="outline" routerLink="/workspaces">Go to Workspaces</a>
                </div>
              </div>
            } @else if (invitePreview(); as invite) {
              <div hlmCard class="overflow-hidden">
                <div class="border-border border-b p-6">
                  <div class="flex items-start gap-4">
                    <div
                      class="bg-primary/10 text-primary flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-md"
                    >
                      @if (invite.canAccept) {
                        <nucleo-icon [icon]="CheckCircle2" class="h-6 w-6" />
                      } @else {
                        <nucleo-icon [icon]="UsersRound" class="h-6 w-6" />
                      }
                    </div>

                    <div class="min-w-0 flex-1">
                      <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <h1 class="text-xl font-medium">{{ statusTitle() }}</h1>
                        <span class="text-muted-foreground rounded-md border px-2 py-1 text-xs">
                          {{ statusLabel() }}
                        </span>
                      </div>
                      <p class="text-muted-foreground mt-2 text-sm leading-6">{{ statusMessage() }}</p>
                    </div>
                  </div>
                </div>

                <div class="space-y-5 p-6">
                  @if (invite.familyGroupName) {
                    <section class="space-y-3">
                      <h2 class="text-sm font-medium">Invite Details</h2>
                      <div class="divide-border rounded-md border">
                        <div class="flex items-center justify-between gap-4 border-b px-4 py-3">
                          <span class="text-muted-foreground text-sm">Family</span>
                          <span class="truncate text-sm font-medium">{{ invite.familyGroupName }}</span>
                        </div>
                        <div class="flex items-center justify-between gap-4 border-b px-4 py-3">
                          <span class="text-muted-foreground text-sm">Sent by</span>
                          <span class="truncate text-sm font-medium">{{
                            invite.invitedByName ?? 'Family manager'
                          }}</span>
                        </div>
                        <div class="flex items-center justify-between gap-4 px-4 py-3">
                          <span class="text-muted-foreground text-sm">Expires</span>
                          <span class="truncate text-sm font-medium">{{ formatDate(invite.expiresAt) }}</span>
                        </div>
                      </div>
                    </section>
                  }

                  @if (invite.currentFamilyGroup; as currentFamily) {
                    <section class="space-y-3">
                      <h2 class="text-sm font-medium">Current Family</h2>
                      <div class="rounded-md border p-4">
                        <div class="flex items-start gap-3">
                          <div
                            class="bg-accent text-muted-foreground flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md"
                          >
                            <nucleo-icon [icon]="UsersRound" class="h-4 w-4" />
                          </div>
                          <div class="min-w-0 flex-1">
                            <p class="truncate text-sm font-medium">{{ currentFamily.name }}</p>
                            <p class="text-muted-foreground mt-1 text-sm">
                              {{ currentFamilyDescription() }}
                            </p>
                          </div>
                        </div>
                      </div>
                    </section>
                  }

                  @if (actionMessage()) {
                    <div class="bg-accent/50 flex items-start gap-3 rounded-md border p-4">
                      <nucleo-icon [icon]="Mail" class="text-muted-foreground mt-0.5 h-4 w-4 flex-shrink-0" />
                      <p class="text-muted-foreground text-sm leading-6">{{ actionMessage() }}</p>
                    </div>
                  }

                  @if (acceptError()) {
                    <div class="border-destructive/40 bg-destructive/5 text-destructive rounded-md border p-4 text-sm">
                      {{ acceptError() }}
                    </div>
                  }
                </div>

                <div class="bg-accent/30 flex flex-col gap-3 border-t p-6 sm:flex-row sm:justify-end">
                  <a hlmBtn variant="outline" routerLink="/workspaces" class="w-full sm:w-auto">Go to Workspaces</a>

                  @if (invite.canAccept) {
                    <button
                      hlmBtn
                      type="button"
                      class="w-full sm:w-auto"
                      [disabled]="accepting()"
                      (click)="acceptInvite()"
                      data-testid="accept-family-invite"
                    >
                      @if (accepting()) {
                        <nucleo-icon [icon]="LoaderCircle" class="h-4 w-4 animate-spin" />
                        Joining...
                      } @else {
                        Join Family
                        <nucleo-icon [icon]="ArrowRight" class="h-4 w-4" />
                      }
                    </button>
                  }
                </div>
              </div>
            }
          </div>
        </div>
      </main>
    </div>
  `,
})
export class FamilyJoinComponent implements OnInit {
  protected readonly AlertCircle = AlertCircle;
  protected readonly ArrowRight = ArrowRight;
  protected readonly CheckCircle2 = CheckCircle2;
  protected readonly LoaderCircle = LoaderCircle;
  protected readonly Mail = Mail;
  protected readonly UsersRound = UsersRound;

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly convexService = inject(ConvexService);
  private readonly inviteToken = this.route.snapshot.paramMap.get('token')?.trim() ?? '';

  protected readonly loading = signal(true);
  protected readonly accepting = signal(false);
  protected readonly invitePreview = signal<FamilyGroupInvitePreview | null>(null);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly acceptError = signal<string | null>(null);

  protected readonly statusTitle = computed(() => {
    const invite = this.invitePreview();
    if (!invite) {
      return 'Family invite';
    }

    switch (invite.status) {
      case 'available':
        return `Join ${invite.familyGroupName ?? 'this family'}`;
      case 'already_in_family':
        return 'Already joined';
      case 'email_mismatch':
        return 'Use the invited email';
      case 'must_leave_current_family':
        return 'Leave current family first';
      case 'owner_must_remove_members':
        return 'Remove members first';
      case 'accepted':
        return 'Invite already accepted';
      case 'revoked':
        return 'Invite revoked';
      case 'expired':
        return 'Invite expired';
      case 'unavailable':
        return 'Invite unavailable';
      case 'not_found':
        return 'Invite not found';
    }
  });

  protected readonly statusLabel = computed(() => {
    const invite = this.invitePreview();
    if (!invite) {
      return 'Loading';
    }

    switch (invite.status) {
      case 'available':
        return 'Ready';
      case 'already_in_family':
        return 'Joined';
      case 'must_leave_current_family':
      case 'owner_must_remove_members':
        return 'Action needed';
      case 'email_mismatch':
        return 'Wrong account';
      case 'not_found':
        return 'Missing';
      case 'accepted':
      case 'revoked':
      case 'expired':
      case 'unavailable':
        return 'Unavailable';
    }
  });

  protected readonly statusMessage = computed(() => {
    const invite = this.invitePreview();
    if (!invite) {
      return '';
    }

    switch (invite.status) {
      case 'available':
        return `${invite.invitedByName ?? 'A family manager'} invited you to join ${invite.familyGroupName ?? 'their family'}.`;
      case 'already_in_family':
        return `You're already a member of ${invite.familyGroupName ?? 'this family'}.`;
      case 'email_mismatch':
        return 'This invite is for a different account. Sign in with the email address that received the invite.';
      case 'must_leave_current_family':
        return `You're a member of ${invite.currentFamilyGroup?.name ?? 'another family'}. Leave that family before joining this one.`;
      case 'owner_must_remove_members':
        return `You're the owner of ${invite.currentFamilyGroup?.name ?? 'another family'} and still have members there. Remove them before joining this family.`;
      case 'accepted':
        return 'This invite has already been accepted.';
      case 'revoked':
        return 'This invite was revoked by the family manager.';
      case 'expired':
        return 'This invite has expired. Ask the family manager to send a new one.';
      case 'unavailable':
        return 'This invite is not ready to accept yet. Try again after the family manager sends it.';
      case 'not_found':
        return 'This invite link is invalid or no longer exists.';
    }
  });

  protected readonly actionMessage = computed(() => {
    const invite = this.invitePreview();
    const currentFamily = invite?.currentFamilyGroup;

    if (!invite || !currentFamily) {
      return null;
    }

    if (invite.canAccept && currentFamily.role === 'owner' && currentFamily.otherActiveMemberCount === 0) {
      return 'Accepting this invite will close your current empty family and move you into the invited family.';
    }

    if (invite.status === 'must_leave_current_family') {
      return 'Go to Family settings to leave your current family, then return to this invite link.';
    }

    if (invite.status === 'owner_must_remove_members') {
      return 'Go to Family settings to remove current members, then return to this invite link.';
    }

    return null;
  });

  ngOnInit(): void {
    void this.loadInvitePreview();
  }

  protected currentFamilyDescription(): string {
    const currentFamily = this.invitePreview()?.currentFamilyGroup;
    if (!currentFamily) {
      return '';
    }

    const role = currentFamily.role === 'owner' ? 'owner' : 'member';
    const otherMembers = currentFamily.otherActiveMemberCount;
    if (otherMembers === 0) {
      return `You're the ${role}; there are no other members.`;
    }

    return `You're the ${role}; ${otherMembers} other ${otherMembers === 1 ? 'member is' : 'members are'} active.`;
  }

  protected formatDate(value: string | null): string {
    if (!value) {
      return 'Unknown';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return 'Unknown';
    }

    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  protected async acceptInvite(): Promise<void> {
    const invite = this.invitePreview();
    if (!invite?.canAccept || this.accepting()) {
      return;
    }

    this.accepting.set(true);
    this.acceptError.set(null);

    try {
      await this.convexService.mutation(api.familyGroups.acceptInvite, {
        inviteToken: this.inviteToken,
      });
      toast.success('Joined family');
      await this.router.navigateByUrl('/workspaces');
    } catch (error: unknown) {
      const message = this.extractErrorMessage(error, 'Failed to join family');
      this.acceptError.set(message);
      toast.error(message);
      await this.loadInvitePreview({ preserveLoadingState: true });
    } finally {
      this.accepting.set(false);
    }
  }

  private async loadInvitePreview(options: { preserveLoadingState?: boolean } = {}): Promise<void> {
    if (!this.inviteToken) {
      this.loading.set(false);
      this.errorMessage.set('This family invite link is missing a token.');
      return;
    }

    if (!options.preserveLoadingState) {
      this.loading.set(true);
    }
    this.errorMessage.set(null);

    try {
      await this.waitForBackendAuth();
      const preview = await this.queryInvitePreviewWithProfileRetry();
      this.invitePreview.set(preview);
    } catch (error: unknown) {
      this.errorMessage.set(this.extractErrorMessage(error, 'Family invite could not be loaded'));
    } finally {
      this.loading.set(false);
    }
  }

  private async queryInvitePreviewWithProfileRetry(): Promise<FamilyGroupInvitePreview> {
    const startTime = Date.now();
    let lastError: Error | null = null;

    while (Date.now() - startTime < PROFILE_RETRY_WAIT_MS) {
      try {
        return await this.convexService.getClient().query(api.familyGroups.getInvitePreview, {
          inviteToken: this.inviteToken,
        });
      } catch (error: unknown) {
        if (!this.isProfileSetupError(error)) {
          throw this.toError(error, 'Family invite could not be loaded');
        }

        lastError = this.toError(error, 'Account setup is taking longer than expected. Please try again.');
        await this.wait(WAIT_INTERVAL_MS);
      }
    }

    throw lastError ?? new Error('Account setup is taking longer than expected. Please try again.');
  }

  private async waitForBackendAuth(): Promise<void> {
    const startTime = Date.now();

    while (!this.convexService.isAuthenticated()) {
      if (Date.now() - startTime > BACKEND_AUTH_WAIT_MS) {
        throw new Error('Backend authentication timeout. Please refresh and try again.');
      }
      await this.wait(WAIT_INTERVAL_MS);
    }
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private isProfileSetupError(error: unknown): boolean {
    return this.extractErrorMessage(error, '').includes('User profile not found');
  }

  private extractErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof ConvexError && typeof error.data === 'string') {
      return error.data;
    }

    if (error instanceof Error && error.message.trim().length > 0) {
      return error.message;
    }

    return fallback;
  }

  private toError(error: unknown, fallback: string): Error {
    return error instanceof Error ? error : new Error(fallback);
  }
}
