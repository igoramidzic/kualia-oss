import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import {
  nucleoCheck as Check,
  nucleoChevronRight as ChevronRight,
  NucleoIcon,
  nucleoSystemAppearance as Monitor,
  nucleoMoon as Moon,
  nucleoAppearance as Palette,
  nucleoSun as Sun,
} from '@kualia/icons';
import { Theme, UserPreferencesService } from '../../core/services/preferences/user-preferences.service';
import {
  HlmDropdownMenuItem,
  HlmDropdownMenuItemSubIndicator,
  HlmDropdownMenuSub,
  HlmDropdownMenuTrigger,
} from '../../ui/dropdown-menu/src';

interface ThemeOption {
  value: Theme;
  label: string;
  icon: typeof Sun;
}

@Component({
  selector: 'app-theme-toggle',
  imports: [
    NucleoIcon,
    HlmDropdownMenuTrigger,
    HlmDropdownMenuItem,
    HlmDropdownMenuItemSubIndicator,
    HlmDropdownMenuSub,
  ],
  templateUrl: './theme-toggle.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ThemeToggleComponent {
  protected readonly Palette = Palette;
  protected readonly ChevronRight = ChevronRight;
  protected readonly Check = Check;

  protected readonly userPreferencesService = inject(UserPreferencesService);
  protected readonly currentTheme = computed(() => this.userPreferencesService.theme());

  protected readonly themeOptions: ThemeOption[] = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: Monitor },
  ];

  protected selectTheme(theme: Theme): void {
    this.userPreferencesService.setTheme(theme);
  }
}
