import { Injectable, computed, signal } from '@angular/core';
import type { KualiaIconData } from '@kualia/icons';
import { legacyIconNames, kualiaIcons, type KualiaIconName } from '../icons/icon-catalog';

@Injectable({
  providedIn: 'root',
})
export class IconService {
  private readonly _searchQuery = signal<string>('');
  private readonly _allIconNames = signal<string[]>(Object.keys(kualiaIcons).sort());

  readonly allIcons = this._allIconNames.asReadonly();

  readonly filteredIcons = computed(() => {
    const query = this._searchQuery().toLowerCase().trim();
    const icons = this._allIconNames();

    if (!query) {
      return icons;
    }

    return icons.filter((name) => {
      return (
        name.toLowerCase().includes(query) ||
        Object.entries(legacyIconNames).some(([alias, canonical]) => {
          return canonical === name && alias.toLowerCase().includes(query);
        })
      );
    });
  });

  setSearchQuery(query: string): void {
    this._searchQuery.set(query);
  }

  getIconByName(name: string): KualiaIconData | null {
    const canonical = this.resolveIconName(name);
    return canonical === null ? null : kualiaIcons[canonical];
  }

  resolveIconName(name: string): KualiaIconName | null {
    if (Object.hasOwn(kualiaIcons, name)) return name as KualiaIconName;
    const alias = Object.hasOwn(legacyIconNames, name) ? legacyIconNames[name] : undefined;
    return alias ?? null;
  }
}
