import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogFooter, HlmDialogHeader } from '@spartan-ng/helm/dialog';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';
import { api } from 'convex/_generated/api';
import { ConvexError } from 'convex/values';
import { nucleoLoader as LoaderCircle, NucleoIcon } from '@kualia/icons';
import { toast } from 'ngx-sonner';
import { ConvexService } from '../../../services/convex.service';

interface DialogContext {
  onClose: (invited?: boolean) => void;
}

@Component({
  selector: 'app-invite-family-member-dialog',
  imports: [ReactiveFormsModule, HlmButton, HlmDialogHeader, HlmDialogFooter, HlmInput, HlmLabel, NucleoIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form [formGroup]="inviteForm" (ngSubmit)="sendInvite()">
      <hlm-dialog-header>
        <h2 class="text-lg font-semibold">Invite Member</h2>
        <p class="text-muted-foreground text-sm">Send an invite to someone you budget with.</p>
      </hlm-dialog-header>

      <div class="space-y-4 p-4">
        <div class="space-y-2">
          <label hlmLabel for="invitee-name" class="text-sm">Name</label>
          <input
            hlmInput
            id="invitee-name"
            type="text"
            formControlName="invitedName"
            autocomplete="name"
            class="h-10 w-full"
            [disabled]="sending()"
          />
          @if (invitedNameError) {
            <p class="text-destructive text-xs">{{ invitedNameError }}</p>
          }
        </div>

        <div class="space-y-2">
          <label hlmLabel for="invitee-email" class="text-sm">Email</label>
          <input
            hlmInput
            id="invitee-email"
            type="email"
            formControlName="invitedEmail"
            autocomplete="email"
            class="h-10 w-full"
            [disabled]="sending()"
          />
          @if (invitedEmailError) {
            <p class="text-destructive text-xs">{{ invitedEmailError }}</p>
          }
        </div>

        @if (error()) {
          <div class="bg-destructive/10 text-destructive border-destructive/20 rounded-lg border p-3">
            <p class="text-sm">{{ error() }}</p>
          </div>
        }
      </div>

      <hlm-dialog-footer>
        <button hlmBtn type="button" size="sm" variant="outline" (click)="cancel()" [disabled]="sending()">
          Cancel
        </button>
        <button hlmBtn type="submit" size="sm" [disabled]="inviteForm.invalid || sending()">
          @if (sending()) {
            <nucleo-icon [icon]="LoaderCircle" class="mr-2 h-4 w-4 animate-spin" />
            Sending...
          } @else {
            Send Invite
          }
        </button>
      </hlm-dialog-footer>
    </form>
  `,
})
export class InviteFamilyMemberDialogComponent {
  protected readonly LoaderCircle = LoaderCircle;

  private readonly convexService = inject(ConvexService);
  private readonly fb = inject(FormBuilder);
  protected readonly dialogContext = injectBrnDialogContext<DialogContext>();

  protected readonly sending = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly inviteForm = this.fb.nonNullable.group({
    invitedName: ['', [Validators.required.bind(Validators)]],
    invitedEmail: ['', [Validators.required.bind(Validators), Validators.email.bind(Validators)]],
  });

  protected get invitedNameError(): string | null {
    const control = this.inviteForm.controls.invitedName;
    if (!control.touched || !control.errors) return null;
    if (control.errors['required']) return 'Enter a name';
    return null;
  }

  protected get invitedEmailError(): string | null {
    const control = this.inviteForm.controls.invitedEmail;
    if (!control.touched || !control.errors) return null;
    if (control.errors['required']) return 'Enter an email';
    if (control.errors['email']) return 'Enter a valid email';
    return null;
  }

  protected cancel(): void {
    this.dialogContext.onClose(false);
  }

  protected async sendInvite(): Promise<void> {
    if (this.inviteForm.invalid || this.sending()) {
      this.inviteForm.markAllAsTouched();
      return;
    }

    const invitedName = this.inviteForm.controls.invitedName.value.trim();
    const invitedEmail = this.inviteForm.controls.invitedEmail.value.trim();

    this.sending.set(true);
    this.error.set(null);

    try {
      await this.convexService.action(api.familyGroups.createInvite, {
        invitedName,
        invitedEmail,
      });
      toast.success('Invite sent');
      this.dialogContext.onClose(true);
    } catch (error: unknown) {
      const message =
        error instanceof ConvexError && typeof error.data === 'string' ? error.data : 'Failed to send invite';
      this.error.set(message);
      this.sending.set(false);
    }
  }
}
