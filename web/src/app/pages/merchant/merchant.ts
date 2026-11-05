import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, effect, inject, OnInit } from '@angular/core';
import { ActivatedRoute, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { HlmSkeleton } from '@spartan-ng/helm/skeleton';
import {
  nucleoTransfer as ArrowLeftRight,
  nucleoChevronRight as ChevronRight,
  nucleoDots as Ellipsis,
  nucleoMerge as GitMerge,
  NucleoIcon,
  nucleoReports as SquareChartGantt,
  nucleoTrash as Trash2,
} from '@kualia/icons';
import { toast } from 'ngx-sonner';
import { DeleteMerchantDialogComponent } from '../../components/dialogs/delete-merchant-dialog/delete-merchant-dialog';
import { MergeMerchantDialogComponent } from '../../components/dialogs/merge-merchant-dialog/merge-merchant-dialog';
import { SidebarToggleComponent } from '../../components/sidebar-toggle/sidebar-toggle';
import { Merchant, MerchantService } from '../../services/merchant.service';
import { NavigationService } from '../../services/navigation.service';
import { WorkspaceService } from '../../services/workspace.service';
import { HlmDropdownMenu, HlmDropdownMenuItem, HlmDropdownMenuTrigger } from '../../ui/dropdown-menu/src';
import { MerchantPageService } from './merchant-page.service';

export function merchantRequiresDeleteTarget(merchant: Merchant): boolean {
  return merchant.transactionCount > 0 || merchant.activeRecurringTransactionCount > 0;
}

@Component({
  selector: 'app-merchant',
  imports: [
    RouterOutlet,
    NucleoIcon,
    SidebarToggleComponent,
    RouterLink,
    HlmDropdownMenu,
    HlmDropdownMenuItem,
    HlmDropdownMenuTrigger,
    CommonModule,
    RouterLink,
    RouterLinkActive,
    HlmSkeleton,
    HlmButton,
  ],
  providers: [MerchantPageService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './merchant.html',
  host: {
    class: 'block h-full',
  },
})
export class MerchantComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly navigationService = inject(NavigationService);
  private readonly workspaceService = inject(WorkspaceService);
  private readonly merchantService = inject(MerchantService);
  private readonly merchantPageService = inject(MerchantPageService);
  private readonly dialogService = inject(HlmDialogService);
  protected readonly ChevronRight = ChevronRight;
  protected readonly Ellipsis = Ellipsis;
  protected readonly SquareChartGantt = SquareChartGantt;
  protected readonly ArrowLeftRight = ArrowLeftRight;
  protected readonly GitMerge = GitMerge;
  protected readonly Trash2 = Trash2;

  readonly merchant = this.merchantPageService.merchant;
  readonly merchantNameEdit = this.merchantPageService.merchantNameEdit;
  readonly isLoading = this.merchantPageService.isLoading;
  private merchantInitialized = false;

  constructor() {
    // Watch for merchant deletion and navigate away
    effect(() => {
      const merchant = this.merchant();
      // Only navigate away if we've already initialized and the merchant disappears
      if (this.merchantInitialized && !merchant) {
        void this.navigationService.navigateToWorkspace(['settings', 'merchants']);
      }
    });

    // Watch for merchant name changes and update URL
    effect(() => {
      const merchant = this.merchant();
      const editedName = this.merchantNameEdit();

      if (merchant && editedName && editedName !== merchant.name) {
        // Update the URL to reflect the new name
        const newSlug = this.getMerchantSlug(editedName, merchant._id);
        const currentSlug = this.route.snapshot.paramMap.get('slug');

        // Only update if the slug has changed
        if (currentSlug && currentSlug !== newSlug) {
          const workspaceShortId = this.workspaceService.workspaceShortId();
          if (workspaceShortId) {
            // Get current route segments to preserve the child route (e.g., /details)
            const currentPath = this.router.url;
            const pathParts = currentPath.split('/');
            const detailsIndex = pathParts.indexOf('details');

            // Build new path with updated slug
            const newPath = `/${workspaceShortId}/settings/merchants/${newSlug}${detailsIndex >= 0 ? '/details' : ''}`;
            void this.router.navigateByUrl(newPath, { replaceUrl: true });
          }
        }
      }
    });

    // Watch for merchant updates in the merchants list and update the page service
    effect(() => {
      const currentMerchant = this.merchant();
      if (!currentMerchant) return;

      // Find the latest version of this merchant in the merchants list
      const merchants = this.merchantService.merchants();
      const updatedMerchant = merchants.find((m) => m._id === currentMerchant._id);

      if (updatedMerchant && updatedMerchant.updatedAt !== currentMerchant.updatedAt) {
        // Only update if the merchant has actually changed (different updatedAt timestamp)
        this.merchantPageService.setMerchant(updatedMerchant);
      }
    });
  }

  ngOnInit() {
    const slug = this.route.snapshot.paramMap.get('slug');
    if (slug) {
      // Extract merchant ID from slug (last 8 characters)
      const merchantId = slug.slice(-8);
      void this.fetchMerchant(merchantId);

      // Check if merchant exists after loading
      const checkMerchant = () => {
        // Make sure we have a workspace before checking merchant
        if (!this.workspaceService.workspaceId()) {
          setTimeout(checkMerchant, 50);
          return;
        }

        // Wait for loading to complete before checking if merchant exists
        if (this.isLoading()) {
          setTimeout(checkMerchant, 50);
          return;
        }

        this.merchantInitialized = true;
        if (!this.merchant()) {
          void this.navigationService.navigateToWorkspace(['settings', 'merchants']);
        }
      };

      // Start checking after a small delay to allow initial data load
      setTimeout(checkMerchant, 50);
    }
  }

  private async fetchMerchant(shortId: string) {
    this.merchantPageService.setLoading(true);
    try {
      // First check if merchant is in the local cache
      const merchants = this.merchantService.merchants();
      const cachedMerchant = merchants.find((m) => m._id.slice(-8) === shortId);

      if (cachedMerchant) {
        this.merchantPageService.setMerchant(cachedMerchant);
        return;
      }

      // If not in cache, fetch from server by short ID
      const merchant = await this.merchantService.getMerchantByShortId(shortId);
      this.merchantPageService.setMerchant(merchant);
    } finally {
      this.merchantPageService.setLoading(false);
    }
  }

  getMerchantDisplay(): string {
    const merchant = this.merchant();
    if (!merchant) return '';
    // Use the edited name so the header updates in real-time
    return this.merchantNameEdit() || merchant.name;
  }

  getMerchantSlug(merchantName: string, merchantId: string): string {
    const namePart = merchantName
      .slice(0, 24)
      .replace(/[\s/\\]+/g, '-')
      .replace(/[^a-zA-Z0-9-]/g, '')
      .toLowerCase();
    const idPart = merchantId.slice(-8);
    return `${namePart}-${idPart}`;
  }

  openMergeDialog() {
    const merchant = this.merchant();
    if (!merchant) return;

    const dialogRef = this.dialogService.open(MergeMerchantDialogComponent, {
      context: {
        merchant,
        onClose: (merged?: boolean) => {
          dialogRef.close();
          if (merged) {
            void this.navigationService.navigateToWorkspace(['settings', 'merchants']);
            toast.success('Merchants merged successfully');
          }
        },
      },
      hasBackdrop: true,
      backdropClass: 'bg-background/65',
      closeOnBackdropClick: true,
      disableClose: false,
      contentClass: 'max-w-full sm:w-md',
    });
  }

  openDeleteDialog() {
    const merchant = this.merchant();
    if (!merchant) return;

    if (this.merchantHasReferences(merchant)) {
      this.openMoveAndDeleteDialog();
      return;
    }

    const dialogRef = this.dialogService.open(DeleteMerchantDialogComponent, {
      context: {
        merchant,
        onClose: (result?: { deleted?: boolean; requiresTarget?: boolean }) => {
          dialogRef.close();
          if (result?.requiresTarget) {
            this.openMoveAndDeleteDialog();
            return;
          }
          if (result?.deleted) {
            void this.navigationService.navigateToWorkspace(['settings', 'merchants']);
            toast.success('Merchant deleted');
          }
        },
      },
      hasBackdrop: true,
      backdropClass: 'bg-background/65',
      closeOnBackdropClick: true,
      disableClose: false,
      contentClass: 'max-w-full sm:w-md',
    });
  }

  private openMoveAndDeleteDialog(): void {
    const merchant = this.merchant();
    if (!merchant) return;

    const dialogRef = this.dialogService.open(MergeMerchantDialogComponent, {
      context: {
        merchant,
        mode: 'delete',
        onClose: (deleted?: boolean) => {
          dialogRef.close();
          if (deleted) {
            void this.navigationService.navigateToWorkspace(['settings', 'merchants']);
            toast.success('Merchant deleted');
          }
        },
      },
      hasBackdrop: true,
      backdropClass: 'bg-background/65',
      closeOnBackdropClick: true,
      disableClose: false,
      contentClass: 'max-w-full sm:w-md',
    });
  }

  private merchantHasReferences(merchant: Merchant): boolean {
    return merchantRequiresDeleteTarget(merchant);
  }
}
