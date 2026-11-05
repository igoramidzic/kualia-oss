import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { HlmButton } from '@spartan-ng/helm/button';
import {
  NucleoIcon,
  nucleoSidebarRightClose as PanelRightClose,
  nucleoSidebarRightOpen as PanelRightOpen,
} from '@kualia/icons';
import { UserPreferencesService } from '../../core/services/preferences/user-preferences.service';

@Component({
  selector: 'app-bank-account-sidebar-toggle',
  imports: [NucleoIcon, HlmButton],
  template: `
    <button
      hlmBtn
      [class.text-foreground]="userPreferencesService.bankAccountSidebarOpen()"
      [class.text-muted-foreground]="!userPreferencesService.bankAccountSidebarOpen()"
      [class.dark:text-foreground]="userPreferencesService.bankAccountSidebarOpen()"
      [class.dark:text-muted-foreground]="!userPreferencesService.bankAccountSidebarOpen()"
      class="hover:text-foreground dark:hover:text-foreground hover:bg-transparent dark:hover:bg-transparent"
      variant="ghost"
      size="icon"
      (click)="toggle()"
      [attr.aria-label]="userPreferencesService.bankAccountSidebarOpen() ? 'Close sidebar' : 'Open sidebar'"
    >
      <nucleo-icon [icon]="icon()" class="h-4 w-4" />
    </button>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BankAccountSidebarToggleComponent {
  protected readonly userPreferencesService = inject(UserPreferencesService);

  protected readonly icon = computed(() =>
    this.userPreferencesService.bankAccountSidebarOpen() ? PanelRightOpen : PanelRightClose
  );

  toggle(): void {
    this.userPreferencesService.toggleBankAccountSidebar();
  }
}
