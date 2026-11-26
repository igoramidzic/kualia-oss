import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmSkeleton } from '@spartan-ng/helm/skeleton';
import {
  kualiaTransfer as ArrowLeftRight,
  kualiaChevronRight as ChevronRight,
  kualiaDots as Ellipsis,
  kualiaMerge as GitMerge,
  KualiaIcon,
  kualiaReports as SquareChartGantt,
  kualiaTrash as Trash2,
} from '@kualia/icons';
import { HlmDropdownMenu, HlmDropdownMenuItem, HlmDropdownMenuTrigger } from '../../ui/dropdown-menu/src';
import { SidebarToggleComponent } from '../sidebar-toggle/sidebar-toggle';

@Component({
  selector: 'app-merchant-page-header',
  imports: [
    CommonModule,
    RouterLink,
    RouterLinkActive,
    KualiaIcon,
    HlmButton,
    HlmDropdownMenuTrigger,
    HlmDropdownMenu,
    HlmDropdownMenuItem,
    HlmSkeleton,
    SidebarToggleComponent,
  ],
  templateUrl: './merchant-page-header.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MerchantPageHeaderComponent {
  protected readonly ChevronRight = ChevronRight;
  protected readonly Ellipsis = Ellipsis;
  protected readonly Trash2 = Trash2;
  protected readonly SquareChartGantt = SquareChartGantt;
  protected readonly ArrowLeftRight = ArrowLeftRight;
  protected readonly GitMerge = GitMerge;

  isLoading = input.required<boolean>();
  hasMerchant = input.required<boolean>();
  merchantDisplay = input<string>('');

  deleteRequested = output<void>();
  mergeRequested = output<void>();
}
