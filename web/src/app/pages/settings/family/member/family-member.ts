import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCard } from '@spartan-ng/helm/card';
import { HlmDialogFooter, HlmDialogHeader, HlmDialogService } from '@spartan-ng/helm/dialog';
import { api } from 'convex/_generated/api';
import { FunctionReturnType } from 'convex/server';
import { ConvexError } from 'convex/values';
import {
  nucleoChevronRight as ChevronRight,
  nucleoLoader as LoaderCircle,
  NucleoIcon,
  nucleoClose as X,
} from '@kualia/icons';
import { toast } from 'ngx-sonner';
import { SidebarToggleComponent } from '../../../../components/sidebar-toggle/sidebar-toggle';
import { ConvexService } from '../../../../services/convex.service';

export type FamilyGroupMemberDetails = NonNullable<FunctionReturnType<typeof api.familyGroups.getMemberDetails>>;

interface RemoveFamilyMemberDialogContext {
  target: FamilyGroupMemberDetails;
  onClose: (removed?: boolean) => void;
}

@Component({
  selector: 'app-remove-family-member-dialog',
  imports: [HlmButton, HlmDialogHeader, HlmDialogFooter],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-dialog-header>
      <h2 class="text-lg font-semibold">{{ dialogTitle }}</h2>
    </hlm-dialog-header>

    <div class="space-y-3 p-4">
      <p class="text-muted-foreground text-sm">
        {{ dialogBody }}
      </p>

      @if (error()) {
        <div class="bg-destructive/10 text-destructive border-destructive/20 rounded-lg border p-3">
          <p class="text-sm">{{ error() }}</p>
        </div>
      }
    </div>

    <hlm-dialog-footer>
      <button hlmBtn type="button" size="sm" variant="outline" (click)="cancel()" [disabled]="removing()">
        Cancel
      </button>
      <button hlmBtn type="button" size="sm" variant="destructive" (click)="confirmRemove()" [disabled]="removing()">
        {{ actionLabel }}
      </button>
    </hlm-dialog-footer>
  `,
})
export class RemoveFamilyMemberDialogComponent {
  protected readonly LoaderCircle = LoaderCircle;
  protected readonly XIcon = X;

  private readonly convexService = inject(ConvexService);
  protected readonly dialogContext = injectBrnDialogContext<RemoveFamilyMemberDialogContext>();

  protected readonly removing = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly target = this.dialogContext.target;

  protected get actionLabel(): string {
    return this.target.kind === 'invite' ? 'Revoke Invite' : 'Remove Member';
  }

  protected get dialogTitle(): string {
    return this.target.kind === 'invite' ? 'Revoke Invite' : 'Remove Member';
  }

  protected get dialogBody(): string {
    const displayName = this.target.kind === 'invite' ? this.target.email : this.displayName(this.target);
    if (this.target.kind === 'invite') {
      return `Revoke the pending invite for ${displayName}? The invite link will stop working immediately.`;
    }

    return `Remove ${displayName} from this family group? They will lose family group access, but their Kualia account and personal budget will stay intact.`;
  }

  protected cancel(): void {
    this.dialogContext.onClose(false);
  }

  protected async confirmRemove(): Promise<void> {
    if (this.removing()) {
      return;
    }

    this.removing.set(true);
    this.error.set(null);

    try {
      if (this.target.kind === 'invite') {
        await this.convexService.mutation(api.familyGroups.revokeInvite, {
          inviteId: this.target._id,
        });
        toast.success('Invite revoked');
      } else {
        await this.convexService.mutation(api.familyGroups.removeMember, {
          memberId: this.target._id,
        });
        toast.success('Member removed');
      }

      this.dialogContext.onClose(true);
    } catch (error: unknown) {
      const fallback = this.target.kind === 'invite' ? 'Failed to revoke invite' : 'Failed to remove member';
      const message = error instanceof ConvexError && typeof error.data === 'string' ? error.data : fallback;
      this.error.set(message);
      this.removing.set(false);
    }
  }

  private displayName(target: FamilyGroupMemberDetails): string {
    const normalizedName = target.name?.trim() ?? '';
    if (normalizedName.length > 0) {
      return normalizedName;
    }

    const normalizedEmail = target.email?.trim() ?? '';
    return normalizedEmail.length > 0 ? normalizedEmail : 'this member';
  }
}

@Component({
  selector: 'app-family-member',
  imports: [RouterLink, HlmButton, HlmCard, NucleoIcon, SidebarToggleComponent],
  template: `
    <div class="flex h-full flex-col overflow-hidden">
      <div class="flex flex-shrink-0 flex-col border-b select-none">
        <div class="flex h-10 items-center px-3">
          <div class="flex min-w-0 items-center gap-2">
            <app-sidebar-toggle class="flex-shrink-0 lg:hidden" />
            <nav class="flex min-w-0 items-center space-x-1 text-sm">
              <a routerLink="../../" class="text-muted-foreground/60 hover:text-foreground m-0 flex-shrink-0 p-1">
                Family
              </a>
              @if (memberDetails(); as member) {
                <nucleo-icon [icon]="ChevronRight" class="text-muted-foreground h-4 w-4 flex-shrink-0" />
                <span
                  class="fade-in max-w-[200px] min-w-0 truncate text-sm font-medium sm:max-w-[300px]"
                  data-testid="member-breadcrumb-name"
                >
                  {{ displayName(member) }}
                </span>
              } @else if (!isLoading()) {
                <nucleo-icon [icon]="ChevronRight" class="text-muted-foreground h-4 w-4 flex-shrink-0" />
                <span class="text-sm font-medium">Not Found</span>
              }
            </nav>
          </div>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto pb-[200px]">
        <div class="container mx-auto max-w-[640px] p-4 pt-4 transition-all select-none lg:p-6 lg:pt-16">
          @if (memberDetails(); as member) {
            <div class="fade-in">
              <div hlmCard class="p-6">
                <div class="flex items-start gap-4">
                  <div [class]="avatarClass(member)">
                    {{ getInitials(member.name, member.email) }}
                  </div>

                  <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-2">
                      <h1 class="truncate text-2xl">{{ displayName(member) }}</h1>
                      @if (member.kind === 'member' && member.isCurrentUser) {
                        <span class="text-muted-foreground text-sm">(you)</span>
                      }
                    </div>
                    <p class="text-muted-foreground mt-2 truncate text-sm">{{ displayEmail(member) }}</p>
                    <span class="mt-4 inline-flex rounded-md border px-2 py-1 text-xs">{{ statusLabel(member) }}</span>
                  </div>
                </div>
              </div>

              @if (member.canRemove) {
                <section class="border-border mt-8 border-t pt-8">
                  <button
                    hlmBtn
                    type="button"
                    class="text-destructive hover:text-destructive"
                    variant="ghost"
                    (click)="openRemoveDialog()"
                    data-testid="remove-family-member"
                  >
                    <nucleo-icon [icon]="XIcon" class="h-4 w-4" />
                    {{ removeActionLabel(member) }}
                  </button>
                </section>
              }
            </div>
          } @else if (!isLoading()) {
            <div hlmCard class="fade-in p-6">
              <h1 class="text-2xl">Member Not Found</h1>
              <p class="text-muted-foreground mt-2 text-sm">This family group member is no longer available.</p>
            </div>
          }
        </div>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block h-full',
  },
})
export class FamilyMemberComponent {
  protected readonly ChevronRight = ChevronRight;
  protected readonly XIcon = X;

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly convexService = inject(ConvexService);
  private readonly dialogService = inject(HlmDialogService);
  private readonly userId = this.route.snapshot.paramMap.get('userId') ?? '';

  private readonly memberDetailsQuery = this.convexService.query<FamilyGroupMemberDetails | null>(
    api.familyGroups.getMemberDetails,
    { userId: this.userId }
  );

  protected readonly isLoading = computed(() => this.memberDetailsQuery() === undefined);
  protected readonly memberDetails = computed(() => this.memberDetailsQuery() ?? null);

  protected displayName(member: FamilyGroupMemberDetails): string {
    const normalizedName = member.name?.trim() ?? '';
    if (normalizedName.length > 0) {
      return normalizedName;
    }

    const normalizedEmail = member.email?.trim() ?? '';
    return normalizedEmail.length > 0 ? normalizedEmail : 'Kualia member';
  }

  protected displayEmail(member: FamilyGroupMemberDetails): string {
    const normalizedEmail = member.email?.trim() ?? '';
    return normalizedEmail.length > 0 ? normalizedEmail : 'No email on file';
  }

  protected getInitials(name: string | null, email: string | null): string {
    const normalizedName = name?.trim() ?? '';
    const normalizedEmail = email?.trim() ?? '';
    const source = normalizedName.length > 0 ? normalizedName : normalizedEmail;

    if (source.length === 0) {
      return '?';
    }

    const parts = source.split(/\s+/).filter((part) => part.length > 0);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }

    return source[0].toUpperCase();
  }

  protected avatarClass(member: FamilyGroupMemberDetails): string {
    const colorClass =
      member.kind === 'invite'
        ? 'bg-cyan-300 text-cyan-950 dark:bg-cyan-300 dark:text-cyan-950'
        : member.role === 'owner'
          ? 'bg-primary text-primary-foreground'
          : 'bg-lime-300 text-lime-950 dark:bg-lime-300 dark:text-lime-950';

    return `${colorClass} flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-full text-2xl font-medium`;
  }

  protected statusLabel(member: FamilyGroupMemberDetails): string {
    if (member.kind === 'invite') {
      return 'Pending invite';
    }

    return member.role === 'owner' ? 'Group Manager' : 'Member';
  }

  protected removeActionLabel(member: FamilyGroupMemberDetails): string {
    return member.kind === 'invite' ? 'Revoke Invite' : 'Remove Member';
  }

  protected openRemoveDialog(): void {
    const target = this.memberDetails();
    if (!target?.canRemove) {
      return;
    }

    const dialogRef = this.dialogService.open(RemoveFamilyMemberDialogComponent, {
      context: {
        target,
        onClose: (removed?: boolean) => {
          dialogRef.close();
          if (removed) {
            void this.router.navigate(['../../'], { relativeTo: this.route });
          }
        },
      },
      hasBackdrop: true,
      backdropClass: 'bg-background/65',
      closeOnBackdropClick: false,
      disableClose: false,
      contentClass: 'max-w-full sm:w-md',
    });
  }
}
