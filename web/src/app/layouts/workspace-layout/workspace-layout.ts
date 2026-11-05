import { type AfterViewInit, ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { toast } from 'ngx-sonner';
import { CreateMerchantDialogContentComponent } from '../../components/dialogs/create-merchant-dialog/create-merchant-dialog-content';
import { CreateTransactionDialogContentComponent } from '../../components/dialogs/create-transaction-dialog/create-transaction-dialog-content';
import { MerchantService } from '../../services/merchant.service';
import { type CreateTransactionDialogContext, TransactionService } from '../../services/transaction.service';
import { WorkspaceService } from '../../services/workspace.service';

@Component({
  selector: 'app-workspace-layout',
  template: `<router-outlet />`,
  imports: [RouterOutlet],
  host: { class: 'contents' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspaceLayoutComponent implements AfterViewInit {
  private readonly merchantService = inject(MerchantService);
  private readonly transactionService = inject(TransactionService);
  private readonly dialogService = inject(HlmDialogService);
  private readonly workspaceService = inject(WorkspaceService);
  private readonly router = inject(Router);

  ngAfterViewInit(): void {
    // Register merchant dialog opener
    this.merchantService.setDialogOpener(() => {
      const dialogRef = this.dialogService.open(CreateMerchantDialogContentComponent, {
        context: {},
        hasBackdrop: true,
        backdropClass: 'bg-background/65',
        closeOnBackdropClick: true,
        disableClose: false,
        contentClass: 'w-[min(500px,100vw)] gap-0 p-0',
      });

      // Track when dialog closes and handle the result
      dialogRef.closed$.subscribe((result: unknown) => {
        this.merchantService.closeDialog();

        // If merchant was created, show toast with link
        if (
          result &&
          typeof result === 'object' &&
          '_id' in result &&
          'name' in result &&
          typeof result._id === 'string' &&
          typeof result.name === 'string'
        ) {
          const merchantId = result._id;
          const merchantName = result.name;
          const merchantSlug = this.getMerchantSlug(merchantName, merchantId);
          const workspaceShortId = this.workspaceService.workspaceShortId();
          if (workspaceShortId) {
            const merchantUrl = `/${workspaceShortId}/settings/merchants/${merchantSlug}/details`;

            toast.success('Merchant created', {
              action: {
                label: 'View merchant',
                onClick: () => {
                  void this.router.navigate([merchantUrl]);
                },
              },
            });
          }
        }
      });
    });

    // Register transaction dialog opener
    this.transactionService.setDialogOpener((context?: CreateTransactionDialogContext) => {
      const dialogRef = this.dialogService.open(CreateTransactionDialogContentComponent, {
        context: {
          bankAccountId: context?.bankAccountId,
          draft: context?.draft,
          initialDate: context?.initialDate,
          source: context?.source,
        },
        contentClass: 'max-w-full sm:w-md',
      });

      // Handle dialog close and show success toast with "View" action
      dialogRef.closed$.subscribe((result: unknown) => {
        if (result && typeof result === 'object' && '_id' in result) {
          const transactionId = result._id;
          const workspaceShortId = this.workspaceService.workspaceShortId();
          if (workspaceShortId && typeof transactionId === 'string') {
            const transactionUrl = `/${workspaceShortId}/transactions/${transactionId}`;

            toast.success('Transaction created', {
              action: {
                label: 'View',
                onClick: () => {
                  void this.router.navigate([transactionUrl]);
                },
              },
            });
          }
        }
      });
    });
  }

  private getMerchantSlug(merchantName: string, merchantId: string): string {
    const namePart = merchantName
      .slice(0, 24)
      .replace(/[\s/\\]+/g, '-')
      .replace(/[^a-zA-Z0-9-]/g, '')
      .toLowerCase();
    const idPart = merchantId.slice(-8);
    return `${namePart}-${idPart}`;
  }
}
