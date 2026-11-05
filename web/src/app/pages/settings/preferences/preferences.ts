import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCard } from '@spartan-ng/helm/card';
import {
  nucleoCheck as Check,
  nucleoChevronDown as ChevronDown,
  NucleoIcon,
  nucleoSystemAppearance as Monitor,
  nucleoMoon as Moon,
  nucleoSun as Sun,
} from '@kualia/icons';
import { SettingsPageHeaderComponent } from '../../../components/settings-page-header/settings-page-header';
import { Theme, UserPreferencesService } from '../../../core/services/preferences/user-preferences.service';
import { HlmDropdownMenu, HlmDropdownMenuItem, HlmDropdownMenuTrigger } from '../../../ui/dropdown-menu/src';

interface ThemeOption {
  value: Theme;
  label: string;
  icon: typeof Sun;
}

@Component({
  selector: 'app-preferences',
  imports: [
    FormsModule,
    HlmButton,
    HlmCard,
    NucleoIcon,
    HlmDropdownMenuTrigger,
    HlmDropdownMenu,
    HlmDropdownMenuItem,
    SettingsPageHeaderComponent,
  ],
  templateUrl: './preferences.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block h-full',
  },
})
export class PreferencesComponent {
  protected readonly userPreferencesService = inject(UserPreferencesService);
  protected readonly ChevronDown = ChevronDown;
  protected readonly Check = Check;

  protected readonly currentTheme = computed(() => this.userPreferencesService.theme());

  protected readonly themeOptions: ThemeOption[] = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: Monitor },
  ];

  protected selectTheme(theme: Theme): void {
    this.userPreferencesService.setTheme(theme);
  }

  protected getThemeIcon(theme: Theme): typeof Sun {
    return this.themeOptions.find((option) => option.value === theme)?.icon ?? Monitor;
  }

  protected getThemeLabel(theme: Theme): string {
    return this.themeOptions.find((option) => option.value === theme)?.label ?? 'System';
  }
}
