import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NavigationStart, Router, RouterLink } from '@angular/router';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCard } from '@spartan-ng/helm/card';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { HlmInputGroupImports } from '@spartan-ng/helm/input-group';
import { HlmSelectImports } from '@spartan-ng/helm/select';
import { HlmSkeleton } from '@spartan-ng/helm/skeleton';
import { nucleoSort as ArrowUpDown, NucleoIcon, nucleoPlus as Plus, nucleoSearch as Search } from '@kualia/icons';
import { toast } from 'ngx-sonner';
import { filter } from 'rxjs';
import { CreateMerchantDialogContentComponent } from '../../../components/dialogs/create-merchant-dialog/create-merchant-dialog-content';
import { EntityMarkComponent } from '../../../components/entity-mark/entity-mark.component';
import { SettingsPageHeaderComponent } from '../../../components/settings-page-header/settings-page-header';
import { MerchantSortOrder, UserPreferencesService } from '../../../core/services/preferences/user-preferences.service';
import { CurrencyService } from '../../../services/currency.service';
import { MerchantService } from '../../../services/merchant.service';
import { WorkspaceService } from '../../../services/workspace.service';
import { DEFAULT_MERCHANT_ICON_NAME } from '../../../shared/utils/entity-identity';

const SCROLL_POSITION_KEY = 'merchants-scroll-position';

@Component({
  selector: 'app-merchants',
  imports: [
    FormsModule,
    HlmCard,
    HlmInputGroupImports,
    HlmSkeleton,
    HlmButton,
    NucleoIcon,
    SettingsPageHeaderComponent,
    EntityMarkComponent,
    RouterLink,
    HlmSelectImports,
  ],
  templateUrl: './merchants.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block h-full',
  },
})
export class MerchantsComponent {
  private readonly merchantService = inject(MerchantService);
  private readonly workspaceService = inject(WorkspaceService);
  private readonly dialogService = inject(HlmDialogService);
  private readonly userPreferencesService = inject(UserPreferencesService);
  private readonly currencyService = inject(CurrencyService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');
  protected readonly scrollContainer = viewChild<ElementRef<HTMLDivElement>>('scrollContainer');

  private scrollRestored = false;

  constructor() {
    afterNextRender(() => {
      if (window.innerWidth >= 640) {
        this.searchInput()?.nativeElement.focus();
      }
    });

    // Save scroll position when navigating away from merchants page
    const subscription = this.router.events
      .pipe(
        filter((event) => event instanceof NavigationStart),
        filter((event) => {
          // Only save if we're navigating away from the merchants list page
          const navEvent = event;
          const currentUrl = this.router.url.split('?')[0];
          const nextUrl = navEvent.url.split('?')[0];
          const normalizedCurrentUrl = currentUrl.replace(/\/$/, '');
          const isOnMerchantsList = normalizedCurrentUrl.endsWith('/settings/merchants');
          return isOnMerchantsList && currentUrl !== nextUrl;
        })
      )
      .subscribe(() => {
        this.saveScrollPosition();
      });

    // Cleanup subscription on destroy
    this.destroyRef.onDestroy(() => {
      subscription.unsubscribe();
      // Also save scroll position on component destroy as a fallback
      this.saveScrollPosition();
    });

    // Restore scroll position when both data and DOM are ready
    effect(() => {
      const merchantsList = this.merchants();
      const isLoading = this.loading();
      const container = this.scrollContainer()?.nativeElement;

      // Only restore if:
      // 1. We haven't restored yet (prevent multiple restorations)
      // 2. Not loading or has loaded (data is ready)
      // 3. Merchants are loaded (data is ready)
      // 4. Scroll container exists (DOM is ready)
      if (!this.scrollRestored && (!isLoading || this.hasLoaded()) && merchantsList.length > 0 && container) {
        requestAnimationFrame(() => {
          this.restoreScrollPosition();
          this.scrollRestored = true;
        });
      }
    });
  }

  protected readonly Plus = Plus;
  protected readonly defaultMerchantIconName = DEFAULT_MERCHANT_ICON_NAME;
  protected readonly Search = Search;
  protected readonly ArrowUpDown = ArrowUpDown;

  private readonly searchQuery = signal<string>('');

  protected readonly sortOrder = this.userPreferencesService.merchantSortOrder;

  protected readonly merchants = computed(() => {
    // Show all active (non-deleted) merchants
    const activeMerchants = this.merchantService.merchants().filter((m) => !m.isDeleted);
    const search = this.searchQuery().toLowerCase().trim();
    const sort = this.sortOrder();

    let filteredMerchants = activeMerchants;

    if (search) {
      filteredMerchants = filteredMerchants.filter((merchant) => merchant.name.toLowerCase().includes(search));
    }

    // Sort based on user preference
    return [...filteredMerchants].sort((a, b) => {
      if (sort === 'totalSpent') {
        // Sort by total spent descending (highest first), using absolute value
        return Math.abs(Number(b.totalSpent ?? 0n)) - Math.abs(Number(a.totalSpent ?? 0n));
      }
      // Sort by transaction count descending (highest first)
      return (b.transactionCount ?? 0) - (a.transactionCount ?? 0);
    });
  });

  protected readonly loading = this.merchantService.loading;
  protected readonly hasLoaded = this.merchantService.hasLoaded;

  onSearchChange(event: Event) {
    const input = event.target as HTMLInputElement;
    this.searchQuery.set(input.value);
  }

  onSortChange(sortOrder: MerchantSortOrder | null | undefined) {
    if (!sortOrder) return;

    this.userPreferencesService.setMerchantSortOrder(sortOrder);
  }

  getMerchantRoute(merchantName: string, merchantId: string): string {
    const workspaceShortId = this.workspaceService.workspaceShortId();
    if (!workspaceShortId) return '';
    const slug = this.getMerchantSlug(merchantName, merchantId);
    return `/${workspaceShortId}/settings/merchants/${slug}/details`;
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

  openCreateMerchantDialog(): void {
    const dialogRef = this.dialogService.open(CreateMerchantDialogContentComponent, {
      context: {
        close: (result?: { _id: string; name: string }) => {
          dialogRef.close();
          if (result) {
            toast.success('Merchant created');
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

  formatAmount(amount: bigint | number): string {
    return this.currencyService.format(amount);
  }

  private saveScrollPosition(): void {
    const container = this.scrollContainer()?.nativeElement;
    if (container) {
      const scrollTop = container.scrollTop;
      if (scrollTop > 0) {
        sessionStorage.setItem(SCROLL_POSITION_KEY, scrollTop.toString());
      }
    }
  }

  private restoreScrollPosition(): void {
    const container = this.scrollContainer()?.nativeElement;
    if (!container) {
      return;
    }

    const savedPosition = sessionStorage.getItem(SCROLL_POSITION_KEY);
    if (savedPosition) {
      const scrollTop = parseInt(savedPosition, 10);
      if (!isNaN(scrollTop) && scrollTop > 0) {
        container.scrollTop = scrollTop;
        // Clear saved position after successful restoration
        sessionStorage.removeItem(SCROLL_POSITION_KEY);
      }
    }
  }
}
