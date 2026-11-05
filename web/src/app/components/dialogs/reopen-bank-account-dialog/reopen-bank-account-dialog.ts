import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogFooter, HlmDialogHeader } from '@spartan-ng/helm/dialog';
import { api } from 'convex/_generated/api';
import type { Id } from 'convex/_generated/dataModel';
import { nucleoLoader as LoaderCircle, NucleoIcon } from '@kualia/icons';
import type { BankAccountWithRelations } from '../../../services/bank-account.service';
import { ConvexService } from '../../../services/convex.service';
import { WorkspaceService } from '../../../services/workspace.service';
import { extractConvexErrorMessage } from '../../../shared/utils/convex-error-message';

@Component({
  selector: 'app-reopen-bank-account-dialog',
  imports: [HlmButton, NucleoIcon, HlmDialogHeader, HlmDialogFooter],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-dialog-header>
      <h2 class="text-lg font-semibold">Reopen Bank Account</h2>
    </hlm-dialog-header>

    <div class="p-3">
      <p class="text-sm">
        Are you sure you want to reopen
        <span class="text-foreground font-medium">{{ bankAccount.name }}</span
        >?
      </p>
      <p class="text-muted-foreground mt-3 text-sm">This account will be restored to your active accounts list.</p>
      <p class="text-muted-foreground mt-2 text-sm">You can reconnect to your bank after reopening.</p>
    </div>

    @if (error()) {
      <div class="bg-destructive/10 text-destructive border-destructive/20 mb-4 rounded-lg border p-3">
        <p class="text-sm">{{ error() }}</p>
      </div>
    }

    <hlm-dialog-footer>
      <button hlmBtn size="sm" variant="outline" (click)="cancel()" [disabled]="reopening()">Cancel</button>
      <button hlmBtn size="sm" (click)="confirmReopen()" [disabled]="reopening()">
        @if (reopening()) {
          <nucleo-icon [icon]="LoaderCircle" class="h-4 w-4 animate-spin" />
          Reopening...
        } @else {
          Reopen Account
        }
      </button>
    </hlm-dialog-footer>
  `,
})
export class ReopenBankAccountDialogComponent {
  protected readonly LoaderCircle = LoaderCircle;

  private readonly convexService = inject(ConvexService);
  private readonly workspaceService = inject(WorkspaceService);
  protected readonly dialogContext = injectBrnDialogContext<{
    bankAccount: BankAccountWithRelations;
    onClose: (reopened?: boolean) => void;
  }>();

  protected readonly bankAccount = this.dialogContext.bankAccount;
  protected readonly reopening = signal(false);
  protected readonly error = signal<string | null>(null);

  cancel() {
    this.dialogContext.onClose(false);
  }

  async confirmReopen() {
    if (this.reopening()) return;

    this.reopening.set(true);
    this.error.set(null);

    try {
      const workspaceId = this.workspaceService.workspaceId();
      if (!workspaceId) throw new Error('Workspace not found');

      await this.convexService.getClient().mutation(api.bankAccounts.reopenBankAccount, {
        workspaceId: workspaceId as Id<'workspace'>,
        bankAccountId: this.bankAccount._id,
      });

      this.dialogContext.onClose(true);
    } catch (err: unknown) {
      this.error.set(extractConvexErrorMessage(err, 'Failed to reopen account'));
      this.reopening.set(false);
    }
  }
}
