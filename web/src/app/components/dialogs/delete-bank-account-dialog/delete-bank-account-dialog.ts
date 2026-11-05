import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogFooter, HlmDialogHeader } from '@spartan-ng/helm/dialog';
import { nucleoLoader as LoaderCircle, NucleoIcon } from '@kualia/icons';
import { toast } from 'ngx-sonner';
import { BankAccountService, BankAccountWithRelations } from '../../../services/bank-account.service';
import { extractConvexErrorMessage } from '../../../shared/utils/convex-error-message';

interface DeleteBankAccountDialogContext {
  bankAccount: BankAccountWithRelations;
  onClose: (deleted?: boolean) => void;
}

@Component({
  selector: 'app-delete-bank-account-dialog',
  imports: [HlmButton, NucleoIcon, HlmDialogHeader, HlmDialogFooter],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-dialog-header>
      <h2 class="text-lg font-semibold">Delete Bank Account</h2>
    </hlm-dialog-header>

    <div class="py-4">
      <p class="text-muted-foreground text-sm"></p>
      <p class="mt-3 text-sm">
        This bank account will be moved to trash and permanently deleted after 30 days. All transactions associated with
        this bank account will also be deleted.
      </p>
    </div>

    @if (error()) {
      <div class="bg-destructive/10 text-destructive border-destructive/20 mb-4 rounded-lg border p-3">
        <p class="text-sm">{{ error() }}</p>
      </div>
    }

    <hlm-dialog-footer>
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
export class DeleteBankAccountDialogComponent {
  private readonly dialogContext = injectBrnDialogContext<DeleteBankAccountDialogContext>();
  private readonly bankAccountService = inject(BankAccountService);
  protected readonly LoaderCircle = LoaderCircle;

  protected readonly deleting = signal(false);
  protected readonly error = signal<string | null>(null);

  async confirmDelete() {
    if (this.deleting()) return;

    this.deleting.set(true);
    this.error.set(null);

    try {
      const success = await this.bankAccountService.deleteBankAccount(this.dialogContext.bankAccount._id);

      if (success) {
        toast.success('Bank account deleted successfully');
        this.dialogContext.onClose(true);
      } else {
        this.error.set('Failed to delete bank account. Please try again.');
        this.deleting.set(false);
      }
    } catch (error: unknown) {
      console.error('Failed to delete bank account:', error);
      this.error.set(extractConvexErrorMessage(error, 'Failed to delete bank account. Please try again.'));
      this.deleting.set(false);
    }
  }
}
