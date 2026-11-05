import { Injectable, computed, signal } from '@angular/core';
import type { NucleoIconData } from '@kualia/icons';
import { legacyIconNames, nucleoIconCatalog, type NucleoIconName } from '../icons/icon-catalog';

@Injectable({
  providedIn: 'root',
})
export class IconService {
  private readonly _searchQuery = signal<string>('');
  private readonly _allIconNames = signal<string[]>(Object.keys(nucleoIconCatalog).sort());

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

  getIconByName(name: string): NucleoIconData | null {
    const canonical = this.resolveIconName(name);
    return canonical === null ? null : nucleoIconCatalog[canonical];
  }

  resolveIconName(name: string): NucleoIconName | null {
    if (Object.hasOwn(nucleoIconCatalog, name)) return name as NucleoIconName;
    const alias = Object.hasOwn(legacyIconNames, name) ? legacyIconNames[name] : undefined;
    return alias ?? null;
  }
}
