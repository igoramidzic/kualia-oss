import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { BrnDialogRef } from '@spartan-ng/brain/dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogFooter, HlmDialogHeader } from '@spartan-ng/helm/dialog';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';
import { api } from 'convex/_generated/api';
import { nucleoLoader as LoaderCircle, NucleoIcon } from '@kualia/icons';
import { toast } from 'ngx-sonner';
import { AuthService } from '../../../services/auth.service';
import { ConvexService } from '../../../services/convex.service';
import { extractConvexErrorMessage } from '../../../shared/utils/convex-error-message';

const DELETE_CONFIRMATION = 'DELETE';

@Component({
  selector: 'app-delete-account-dialog',
  imports: [HlmButton, HlmDialogFooter, HlmDialogHeader, HlmInput, HlmLabel, NucleoIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-dialog-header>
      <h2 class="text-lg font-semibold">Delete Account</h2>
    </hlm-dialog-header>

    <div class="space-y-4 p-3">
      <p class="text-muted-foreground text-sm">
        This deletes your Kualia account, all workspaces you own, and their financial data. Anyone sharing those
        workspaces will also lose access. Bank connections will be disconnected. Your sign-in identity and billing
        history are retained so support can still help with subscription issues and you can start fresh later.
      </p>

      <div class="border-destructive/20 bg-destructive/10 rounded-lg border p-3">
        <p class="text-sm font-medium">Web renewals are canceled automatically. App Store subscriptions are not.</p>
        <p class="text-muted-foreground mt-2 text-sm" data-testid="delete-account-subscription-notice">
          Kualia will stop renewal of a web trial or subscription as part of deletion. If you subscribed through Apple,
          cancel separately in Apple Subscriptions. Financial data is retained for 30 days, then permanently removed
          during the next scheduled deletion cycle.
        </p>
      </div>

      <div class="space-y-2">
        <label hlmLabel for="delete-account-confirmation" class="text-sm">
          Type <span class="font-mono font-semibold">{{ confirmationPhrase }}</span> to confirm
        </label>
        <input
          hlmInput
          id="delete-account-confirmation"
          type="text"
          autocomplete="off"
          autocapitalize="characters"
          spellcheck="false"
          [value]="confirmation()"
          (input)="onConfirmationInput($event)"
          [disabled]="deleting()"
          data-testid="delete-account-confirmation-input"
        />
      </div>

      @if (error()) {
        <div class="bg-destructive/10 text-destructive border-destructive/20 rounded-lg border p-3">
          <p class="text-sm">{{ error() }}</p>
        </div>
      }
    </div>

    <hlm-dialog-footer>
      <button hlmBtn size="sm" variant="outline" (click)="dialogRef.close()" [disabled]="deleting()">Cancel</button>
      <button
        hlmBtn
        size="sm"
        variant="destructive"
        (click)="confirmDelete()"
        [disabled]="!canDelete()"
        data-testid="delete-account-confirm-button"
      >
        @if (deleting()) {
          <nucleo-icon [icon]="LoaderCircle" class="h-4 w-4 animate-spin" />
          Deleting...
        } @else {
          Delete Account
        }
      </button>
    </hlm-dialog-footer>
  `,
})
export class DeleteAccountDialogComponent {
  protected readonly dialogRef = inject(BrnDialogRef);
  private readonly convexService = inject(ConvexService);
  private readonly authService = inject(AuthService);

  protected readonly LoaderCircle = LoaderCircle;
  protected readonly confirmationPhrase = DELETE_CONFIRMATION;
  protected readonly confirmation = signal('');
  protected readonly deleting = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly canDelete = computed(() => this.confirmation() === DELETE_CONFIRMATION && !this.deleting());

  protected onConfirmationInput(event: Event): void {
    this.confirmation.set((event.target as HTMLInputElement).value);
  }

  protected async confirmDelete(): Promise<void> {
    if (!this.canDelete()) return;

    this.deleting.set(true);
    this.error.set(null);

    try {
      await this.convexService.action(api.accountDeletion.deleteAccount, {
        confirmation: this.confirmation(),
      });
      toast.success('Your account has been deleted');
      this.dialogRef.close(true);
      await this.authService.logout();
    } catch (error: unknown) {
      this.error.set(extractConvexErrorMessage(error, 'Unable to delete your account. Please try again.'));
      this.deleting.set(false);
    }
  }
}
