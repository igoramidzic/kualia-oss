import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { BrnDialogRef, injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogFooter, HlmDialogHeader } from '@spartan-ng/helm/dialog';
import type { Id } from 'convex/_generated/dataModel';
import { nucleoLoader as LoaderCircle, NucleoIcon } from '@kualia/icons';
import { toast } from 'ngx-sonner';
import { BankAccountService } from '../../../services/bank-account.service';
import { extractConvexErrorMessage } from '../../../shared/utils/convex-error-message';

@Component({
  selector: 'app-disconnect-bank-link-account-dialog',
  imports: [HlmButton, NucleoIcon, HlmDialogHeader, HlmDialogFooter],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-dialog-header>
      <h2 class="text-lg font-semibold">Disconnect Bank Account</h2>
    </hlm-dialog-header>

    <div class="p-3">
      <p class="text-sm">
        Are you sure you want to disconnect this bank account? This will unlink it from your Plaid connection, but will
        not delete the account or its transactions in Kualia.
      </p>

      @if (error()) {
        <div class="bg-destructive/10 text-destructive border-destructive/20 mt-4 rounded-lg border p-3">
          <p class="text-sm">{{ error() }}</p>
        </div>
      }
    </div>

    <hlm-dialog-footer>
      <button hlmBtn size="sm" variant="outline" (click)="dialogRef.close()" [disabled]="disconnecting()">
        Cancel
      </button>
      <button hlmBtn size="sm" variant="destructive" (click)="confirmDisconnect()" [disabled]="disconnecting()">
        @if (disconnecting()) {
          <nucleo-icon [icon]="LoaderCircle" class="h-4 w-4 animate-spin" />
          Disconnecting...
        } @else {
          Disconnect
        }
      </button>
    </hlm-dialog-footer>
  `,
})
export class DisconnectBankLinkAccountDialogComponent {
  protected readonly dialogRef = inject(BrnDialogRef);
  protected readonly dialogContext = injectBrnDialogContext<{ bankAccountId: Id<'bankAccount'> }>();
  private readonly bankAccountService = inject(BankAccountService);
  protected readonly LoaderCircle = LoaderCircle;

  readonly disconnecting = signal(false);
  readonly error = signal<string | null>(null);

  async confirmDisconnect() {
    if (this.disconnecting()) return;

    this.disconnecting.set(true);
    this.error.set(null);

    try {
      await this.bankAccountService.linkToBankLinkAccount(this.dialogContext.bankAccountId, null);
      toast.success('Bank account disconnected successfully');
      this.dialogRef.close(true);
    } catch (error: unknown) {
      console.error('Failed to disconnect bank account:', error);
      this.error.set(extractConvexErrorMessage(error, 'Failed to disconnect bank account. Please try again.'));
      this.disconnecting.set(false);
    }
  }
}
