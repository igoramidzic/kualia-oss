import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { HlmSkeleton } from '@spartan-ng/helm/skeleton';
import { api } from 'convex/_generated/api';
import { Id } from 'convex/_generated/dataModel';
import {
  nucleoTransfer as ArrowLeftRight,
  nucleoChevronRight as ChevronRight,
  nucleoDots as Ellipsis,
  NucleoIcon,
  nucleoReports as SquareChartGantt,
  nucleoTrash as Trash2,
} from '@kualia/icons';
import { toast } from 'ngx-sonner';
import { DeleteCategoryDialogComponent } from '../../components/dialogs/delete-category-dialog/delete-category-dialog';
import { SidebarToggleComponent } from '../../components/sidebar-toggle/sidebar-toggle';
import { CategoryService } from '../../services/category.service';
import { LocalAuthService } from '../../services/local-auth.service';
import { ConvexService } from '../../services/convex.service';
import { NavigationService } from '../../services/navigation.service';
import { WorkspaceService } from '../../services/workspace.service';
import { HlmDropdownMenu, HlmDropdownMenuItem, HlmDropdownMenuTrigger } from '../../ui/dropdown-menu/src';
import { CategoryOverviewPageService } from '../category-details/category-overview-page.service';

@Component({
  selector: 'app-category',
  imports: [
    CommonModule,
    RouterOutlet,
    NucleoIcon,
    HlmButton,
    RouterLink,
    RouterLinkActive,
    SidebarToggleComponent,
    HlmSkeleton,
    HlmDropdownMenu,
    HlmDropdownMenuItem,
    HlmDropdownMenuTrigger,
  ],
  providers: [CategoryOverviewPageService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './category.html',
  host: {
    class: 'block h-full',
  },
})
export class CategoryComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly navigationService = inject(NavigationService);
  private readonly categoryConvexService = inject(CategoryService);
  private readonly convexService = inject(ConvexService);
  private readonly categoryOverviewPageService = inject(CategoryOverviewPageService);
  private readonly dialogService = inject(HlmDialogService);
  private readonly workspaceService = inject(WorkspaceService);
  private readonly clerkService = inject(LocalAuthService);
  protected readonly ArrowLeftRight = ArrowLeftRight;
  protected readonly ChevronRight = ChevronRight;
  protected readonly Ellipsis = Ellipsis;
  protected readonly Trash2 = Trash2;
  protected readonly SquareChartGantt = SquareChartGantt;

  readonly category = this.categoryOverviewPageService.category;
  readonly categoryName = computed(() => this.category()?.name ?? null);
  readonly isLoading = this.categoryOverviewPageService.isLoading;

  private readonly categoryInitialized = signal(false);

  constructor() {
    // Convert route params to signal for reactivity
    const routeParams = toSignal(this.route.paramMap);

    // Watch for route changes and fetch category
    effect(() => {
      const slug = routeParams()?.get('slug');
      if (slug) {
        const shortId = this.extractCategoryIdFromSlug(slug);
        void this.fetchCategory(shortId);
      }
    });

    // Watch for category deletion and navigate away
    effect(() => {
      const category = this.category();
      // Only navigate away if we've already initialized and the category disappears
      if (this.categoryInitialized() && !category && !this.isLoading()) {
        // TODO: navigateToCategories method doesn't exist yet - comment out for now
        // void this.navigationService.navigateToCategories();
      }
    });
  }

  protected readonly workspaceName = computed(() => this.workspaceService.workspace()?.name);
  protected readonly linkToWorkspace = computed(() => {
    const workspaceShortId = this.workspaceService.workspaceShortId();
    return workspaceShortId ? `/${workspaceShortId}` : '/';
  });

  private extractCategoryIdFromSlug(slug: string): string {
    // Extract last 8 characters from the slug
    const parts = slug.split('-');
    return parts[parts.length - 1];
  }

  private async fetchCategory(shortId: string) {
    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) {
      console.error('No workspace ID available');
      this.categoryOverviewPageService.setLoading(false);
      return;
    }

    this.categoryOverviewPageService.setLoading(true);
    try {
      const category = await this.convexService.getClient().query(api.categories.getCategoryByShortIdWithStats, {
        workspaceId: workspaceId as Id<'workspace'>,
        shortId,
      });
      this.categoryOverviewPageService.setCategory(category);
      this.categoryInitialized.set(true);
    } finally {
      this.categoryOverviewPageService.setLoading(false);
    }
  }

  openDeleteDialog() {
    const category = this.category();
    if (!category) return;

    const dialogRef = this.dialogService.open(DeleteCategoryDialogComponent, {
      context: {
        category,
        onClose: (deleted?: boolean) => {
          dialogRef.close();
          if (deleted) {
            // TODO: navigateToCategories method doesn't exist yet - comment out for now
            // Navigate to categories list after successful deletion
            // void this.navigationService.navigateToCategories();

            toast.success('Category deleted');
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
}
