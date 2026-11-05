import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { BrnDialogRef, injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogFooter, HlmDialogHeader } from '@spartan-ng/helm/dialog';
import { api } from 'convex/_generated/api';
import type { Id } from 'convex/_generated/dataModel';
import { nucleoLoader as LoaderCircle, NucleoIcon } from '@kualia/icons';
import { toast } from 'ngx-sonner';
import { ConvexService } from '../../../services/convex.service';
import { ReportingService, TrackingEvent } from '../../../services/reporting.service';
import { extractMappedConvexErrorMessage } from '../../../shared/utils/convex-error-message';

const DELETE_BANK_LINK_FALLBACK_ERROR = 'Failed to disconnect from bank. Please try again.';

function toDeleteBankLinkErrorMessage(error: unknown): string {
  return extractMappedConvexErrorMessage(error, DELETE_BANK_LINK_FALLBACK_ERROR, (message) => {
    if (message === 'Access denied') {
      return 'You do not have permission to delete this bank connection.';
    }

    return message;
  });
}

@Component({
  selector: 'app-delete-bank-link-dialog',
  imports: [HlmButton, NucleoIcon, HlmDialogHeader, HlmDialogFooter],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-dialog-header>
      <h2 class="text-lg font-semibold">Delete Bank Connection</h2>
    </hlm-dialog-header>

    <div class="p-3">
      <p class="text-sm">
        This will permanently disconnect your bank connection from Plaid and remove all associated data, including
        transactions. This action cannot be undone.
      </p>

      @if (error()) {
        <div class="bg-destructive/10 text-destructive border-destructive/20 mb-4 rounded-lg border p-3">
          <p class="text-sm">{{ error() }}</p>
        </div>
      }
    </div>

    <hlm-dialog-footer>
      <button hlmBtn size="sm" variant="outline" (click)="dialogRef.close()" [disabled]="deleting()">Cancel</button>
      <button hlmBtn size="sm" variant="destructive" (click)="confirmDelete()" [disabled]="deleting()">
        @if (deleting()) {
          <nucleo-icon [icon]="LoaderCircle" class="h-4 w-4 animate-spin" />
          Disconnecting...
        } @else {
          Delete Connection
        }
      </button>
    </hlm-dialog-footer>
  `,
})
export class DeleteBankLinkDialogComponent {
  protected readonly dialogRef = inject(BrnDialogRef);
  protected readonly dialogContext = injectBrnDialogContext<{ bankLinkId: Id<'bankLink'> }>();
  private readonly convex = inject(ConvexService);
  private readonly reportingService = inject(ReportingService);
  protected readonly LoaderCircle = LoaderCircle;

  readonly deleting = signal(false);
  readonly error = signal<string | null>(null);

  async confirmDelete() {
    if (this.deleting()) return;

    this.deleting.set(true);
    this.error.set(null);

    try {
      await this.convex.action(api.bankLinks.deleteBankLinkAction, {
        bankLinkId: this.dialogContext.bankLinkId,
      });
      this.reportingService.capture(TrackingEvent.BANK_LINK_DISCONNECTED);

      toast.success('Bank connection deleted successfully');
      this.dialogRef.close(true);
    } catch (error: unknown) {
      console.error('Failed to delete bank link:', error);
      this.error.set(toDeleteBankLinkErrorMessage(error));
      this.deleting.set(false);
    }
  }
}
