import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogFooter, HlmDialogHeader } from '@spartan-ng/helm/dialog';
import { nucleoLoader as LoaderCircle, NucleoIcon } from '@kualia/icons';
import { Merchant, MerchantService } from '../../../services/merchant.service';
import { extractConvexErrorMessage } from '../../../shared/utils/convex-error-message';

type DeleteMerchantDialogResult = { deleted?: boolean; requiresTarget?: boolean };

@Component({
  selector: 'app-delete-merchant-dialog',
  imports: [HlmButton, HlmDialogHeader, HlmDialogFooter, NucleoIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-dialog-header>
      <h2 class="text-lg font-semibold">Delete Merchant</h2>
    </hlm-dialog-header>

    <div class="space-y-3 p-4">
      <p class="text-muted-foreground text-sm">
        Are you sure you want to delete
        <span class="text-foreground font-medium">{{ merchant.name }}</span
        >?
      </p>
      <p class="text-muted-foreground text-sm">This merchant has no active transactions or recurring templates.</p>

      @if (error()) {
        <div class="bg-destructive/10 text-destructive border-destructive/20 rounded-lg border p-3">
          <p class="text-sm">{{ error() }}</p>
        </div>
      }
    </div>

    <hlm-dialog-footer>
      <button hlmBtn size="sm" variant="outline" (click)="cancel()" [disabled]="deleting()">Cancel</button>
      <button hlmBtn size="sm" variant="destructive" (click)="confirmDelete()" [disabled]="deleting()">
        @if (deleting()) {
          <nucleo-icon [icon]="LoaderCircle" class="h-4 w-4 animate-spin" />
          Deleting...
        } @else {
          Delete
        }
      </button>
    </hlm-dialog-footer>
  `,
})
export class DeleteMerchantDialogComponent {
  protected readonly LoaderCircle = LoaderCircle;

  private readonly merchantService = inject(MerchantService);
  protected readonly dialogContext = injectBrnDialogContext<{
    merchant: Merchant;
    onClose: (result?: DeleteMerchantDialogResult) => void;
  }>();

  protected readonly merchant = this.dialogContext.merchant;
  protected readonly deleting = signal(false);
  protected readonly error = signal<string | null>(null);

  cancel(): void {
    this.dialogContext.onClose();
  }

  async confirmDelete(): Promise<void> {
    if (this.deleting()) return;

    this.deleting.set(true);
    this.error.set(null);

    try {
      await this.merchantService.deleteMerchant(this.merchant._id);
      this.dialogContext.onClose({ deleted: true });
    } catch (err: unknown) {
      const message = extractConvexErrorMessage(err, 'Failed to delete merchant');
      if (message.includes('choose another merchant')) {
        this.dialogContext.onClose({ requiresTarget: true });
        return;
      }

      this.error.set(message);
      this.deleting.set(false);
    }
  }
}
