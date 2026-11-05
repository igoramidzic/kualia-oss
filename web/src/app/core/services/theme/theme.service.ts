import { Injectable, effect, inject } from '@angular/core';
import { UserPreferencesService } from '../preferences/user-preferences.service';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly userPreferencesService = inject(UserPreferencesService);

  constructor() {
    effect(() => {
      const theme = this.userPreferencesService.resolvedTheme();
      this.applyTheme(theme);
    });
  }

  applyTheme(theme: 'light' | 'dark'): void {
    const root = document.documentElement;

    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }
}
