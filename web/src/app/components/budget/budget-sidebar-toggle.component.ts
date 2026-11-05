import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { HlmButton } from '@spartan-ng/helm/button';
import {
  NucleoIcon,
  nucleoSidebarRightClose as PanelRightClose,
  nucleoSidebarRightOpen as PanelRightOpen,
} from '@kualia/icons';
import { UserPreferencesService } from '../../core/services/preferences/user-preferences.service';

@Component({
  selector: 'app-budget-sidebar-toggle',
  imports: [NucleoIcon, HlmButton],
  template: `
    <button
      hlmBtn
      [class.text-foreground]="userPreferencesService.budgetSidebarOpen()"
      [class.text-muted-foreground]="!userPreferencesService.budgetSidebarOpen()"
      [class.dark:text-foreground]="userPreferencesService.budgetSidebarOpen()"
      [class.dark:text-muted-foreground]="!userPreferencesService.budgetSidebarOpen()"
      class="hover:text-foreground dark:hover:text-foreground hover:bg-transparent dark:hover:bg-transparent"
      variant="ghost"
      size="icon"
      (click)="toggle()"
      [attr.aria-label]="userPreferencesService.budgetSidebarOpen() ? 'Close sidebar' : 'Open sidebar'"
    >
      <nucleo-icon [icon]="icon()" class="h-4 w-4" />
    </button>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BudgetSidebarToggleComponent {
  protected readonly userPreferencesService = inject(UserPreferencesService);

  protected readonly icon = computed(() =>
    this.userPreferencesService.budgetSidebarOpen() ? PanelRightOpen : PanelRightClose
  );

  toggle(): void {
    this.userPreferencesService.toggleBudgetSidebar();
  }
}
