import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmBadge } from '@spartan-ng/helm/badge';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCard } from '@spartan-ng/helm/card';
import { HlmDialogFooter, HlmDialogHeader, HlmDialogService } from '@spartan-ng/helm/dialog';
import { api } from 'convex/_generated/api';
import { Id } from 'convex/_generated/dataModel';
import { FunctionReturnType } from 'convex/server';
import { ConvexError } from 'convex/values';
import {
  nucleoChevronRight as ChevronRight,
  nucleoLoader as LoaderCircle,
  nucleoLogout as LogOut,
  NucleoIcon,
  nucleoEmailPlus as MailPlus,
  nucleoUsers as UsersRound,
} from '@kualia/icons';
import { toast } from 'ngx-sonner';
import { InviteFamilyMemberDialogComponent } from '../../../components/dialogs/invite-family-member-dialog/invite-family-member-dialog';
import { SettingsPageHeaderComponent } from '../../../components/settings-page-header/settings-page-header';
import { ConvexService } from '../../../services/convex.service';

type FamilyGroup = FunctionReturnType<typeof api.familyGroups.getMine>;
type FamilyGroupView = NonNullable<FamilyGroup>;
type FamilyGroupMember = FamilyGroupView['members'][number];
type FamilyGroupInvite = FamilyGroupView['pendingInvites'][number];

const FAMILY_GROUP_INVITE_LIMIT = 5;

interface LeaveFamilyGroupDialogContext {
  onClose: (left?: boolean) => void;
}

@Component({
  selector: 'app-leave-family-group-dialog',
  imports: [HlmButton, HlmDialogFooter, HlmDialogHeader, NucleoIcon],
  template: `
    <hlm-dialog-header>
      <h2 class="text-lg font-semibold">Leave Family</h2>
    </hlm-dialog-header>

    <div class="space-y-3 p-4">
      <p class="text-muted-foreground text-sm">Leaving removes your access to shared family workspaces and budgets.</p>

      <div class="border-border bg-muted/40 rounded-lg border p-3">
        <p class="text-sm font-medium">Your personal Kualia account stays intact.</p>
        <p class="text-muted-foreground mt-2 text-sm">
          Personal budgets and workspaces remain yours. Shared family data will no longer appear in your account, and a
          family manager will need to invite you again if you want to rejoin.
        </p>
      </div>

      @if (error()) {
        <div class="bg-destructive/10 text-destructive border-destructive/20 rounded-lg border p-3">
          <p class="text-sm">{{ error() }}</p>
        </div>
      }
    </div>

    <hlm-dialog-footer>
      <button
        hlmBtn
        type="button"
        size="sm"
        variant="outline"
        (click)="cancel()"
        [disabled]="leaving()"
        data-testid="cancel-leave-family"
      >
        Cancel
      </button>
      <button
        hlmBtn
        type="button"
        size="sm"
        variant="destructive"
        (click)="confirmLeave()"
        [disabled]="leaving()"
        data-testid="confirm-leave-family"
      >
        @if (leaving()) {
          <nucleo-icon [icon]="LoaderCircle" class="h-4 w-4 animate-spin" />
          Leaving...
        } @else {
          Leave Family
        }
      </button>
    </hlm-dialog-footer>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LeaveFamilyGroupDialogComponent {
  protected readonly LoaderCircle = LoaderCircle;

  private readonly convexService = inject(ConvexService);
  protected readonly dialogContext = injectBrnDialogContext<LeaveFamilyGroupDialogContext>();

  protected readonly leaving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected cancel(): void {
    this.dialogContext.onClose(false);
  }

  protected async confirmLeave(): Promise<void> {
    if (this.leaving()) {
      return;
    }

    this.leaving.set(true);
    this.error.set(null);

    try {
      await this.convexService.mutation(api.familyGroups.leaveGroup, {});
      toast.success('Left family group');
      this.dialogContext.onClose(true);
    } catch (error: unknown) {
      const message =
        error instanceof ConvexError && typeof error.data === 'string' ? error.data : 'Failed to leave family group';
      this.error.set(message);
      this.leaving.set(false);
    }
  }
}

@Component({
  selector: 'app-family',
  imports: [RouterLink, HlmBadge, HlmButton, HlmCard, NucleoIcon, SettingsPageHeaderComponent],
  templateUrl: './family.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block h-full',
  },
})
export class FamilyComponent {
  protected readonly ChevronRight = ChevronRight;
  protected readonly LoaderCircle = LoaderCircle;
  protected readonly LogOut = LogOut;
  protected readonly MailPlus = MailPlus;
  protected readonly UsersRound = UsersRound;

  private readonly convexService = inject(ConvexService);
  private readonly dialogService = inject(HlmDialogService);

  protected readonly creatingGroup = signal(false);

  private readonly familyGroupQuery = this.convexService.query<FamilyGroup>(api.familyGroups.getMine, {});

  protected readonly isLoading = computed(() => this.familyGroupQuery() === undefined);
  protected readonly familyGroup = computed(() => this.familyGroupQuery() ?? null);
  protected readonly groupManagers = computed<FamilyGroupMember[]>(() => {
    const familyGroup = this.familyGroup();
    return familyGroup?.members.filter((member) => member.role === 'owner') ?? [];
  });
  protected readonly members = computed<FamilyGroupMember[]>(() => {
    const familyGroup = this.familyGroup();
    return familyGroup?.members.filter((member) => member.role === 'member') ?? [];
  });
  protected readonly pendingInvites = computed<FamilyGroupInvite[]>(() => this.familyGroup()?.pendingInvites ?? []);
  protected readonly currentUserIsOwner = computed(() => this.familyGroup()?.currentUserRole === 'owner');
  protected readonly currentUserIsMember = computed(() => this.familyGroup()?.currentUserRole === 'member');
  protected readonly inviteEmailQuota = computed(() => this.familyGroup()?.inviteEmailQuota ?? null);
  protected readonly invitesRemaining = computed(() => {
    const usedSlots = this.members().length + this.pendingInvites().length;
    return Math.max(0, FAMILY_GROUP_INVITE_LIMIT - usedSlots);
  });
  protected readonly inviteLimitLabel = computed(
    () => `${this.invitesRemaining()}/${FAMILY_GROUP_INVITE_LIMIT} invites remaining`
  );
  protected readonly inviteEmailQuotaExhausted = computed(() => {
    const quota = this.inviteEmailQuota();
    return quota !== null && quota.remaining <= 0;
  });
  protected readonly inviteEmailQuotaMessage = computed(() => {
    const quota = this.inviteEmailQuota();
    if (!quota || quota.remaining > 0) {
      return null;
    }

    const retryDate = quota.windowEndsAt?.slice(0, 10) ?? 'later';
    return `Invite email limit reached. Try again after ${retryDate}.`;
  });
  protected readonly canInvite = computed(
    () => this.currentUserIsOwner() && this.invitesRemaining() > 0 && !this.inviteEmailQuotaExhausted()
  );

  protected displayMemberName(member: FamilyGroupMember): string {
    const normalizedName = member.name?.trim();
    if (normalizedName && normalizedName.length > 0) {
      return normalizedName;
    }

    const normalizedEmail = member.email?.trim();
    return normalizedEmail && normalizedEmail.length > 0 ? normalizedEmail : 'Kualia member';
  }

  protected displayMemberEmail(member: FamilyGroupMember): string {
    const normalizedEmail = member.email?.trim();
    return normalizedEmail && normalizedEmail.length > 0 ? normalizedEmail : 'No email on file';
  }

  protected getInitials(name: string | null, email: string | null): string {
    const normalizedName = name?.trim();
    const normalizedEmail = email?.trim();
    const source = normalizedName && normalizedName.length > 0 ? normalizedName : normalizedEmail;

    if (!source || source.length === 0) {
      return '?';
    }

    const parts = source.split(/\s+/).filter((part) => part.length > 0);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }

    return source[0].toUpperCase();
  }

  protected async createGroup(): Promise<void> {
    if (this.creatingGroup()) {
      return;
    }

    this.creatingGroup.set(true);

    try {
      await this.convexService.mutation<Id<'familyGroup'>>(api.familyGroups.createGroup, {});
      toast.success('Family group created');
    } catch (error: unknown) {
      const message =
        error instanceof ConvexError && typeof error.data === 'string' ? error.data : 'Failed to create family group';
      toast.error(message);
    } finally {
      this.creatingGroup.set(false);
    }
  }

  protected openLeaveDialog(): void {
    if (!this.currentUserIsMember()) {
      return;
    }

    const dialogRef = this.dialogService.open(LeaveFamilyGroupDialogComponent, {
      context: {
        onClose: () => {
          dialogRef.close();
        },
      },
      hasBackdrop: true,
      backdropClass: 'bg-background/65',
      closeOnBackdropClick: false,
      disableClose: false,
      contentClass: 'max-w-full sm:w-md',
    });
  }

  protected openInviteDialog(): void {
    if (!this.canInvite()) {
      return;
    }

    const dialogRef = this.dialogService.open(InviteFamilyMemberDialogComponent, {
      context: {
        onClose: () => {
          dialogRef.close();
        },
      },
      hasBackdrop: true,
      backdropClass: 'bg-background/65',
      closeOnBackdropClick: true,
      disableClose: false,
      contentClass: 'max-w-full sm:w-md',
    });
  }
}
