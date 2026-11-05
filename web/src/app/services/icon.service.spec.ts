import { IconService } from './icon.service';
import { nucleoIconCatalog } from '../icons/icon-catalog';
import { nucleoShop, nucleoCreditCard, nucleoPaw, nucleoBank, nucleoClose, nucleoTarget } from '@kualia/icons';

describe('IconService', () => {
  it.each([
    ['Store', nucleoShop],
    ['CreditCard', nucleoCreditCard],
    ['PawPrint', nucleoPaw],
    ['Landmark', nucleoBank],
    ['X', nucleoClose],
    ['Target', nucleoTarget],
  ])('renders saved %s choices with Nucleo artwork', (name, artwork) => {
    const service = new IconService();
    expect(service.getIconByName(name)).toBe(artwork);
  });

  it('offers canonical choices that all resolve to their own artwork', () => {
    const service = new IconService();
    expect(service.allIcons()).not.toContain('Store');
    expect(service.allIcons()).toContain('Shop');
    for (const [name, artwork] of Object.entries(nucleoIconCatalog)) {
      expect(service.getIconByName(name)).toBe(artwork);
      const svg = new DOMParser().parseFromString(artwork, 'image/svg+xml');
      expect(svg.querySelector('parsererror'), name).toBeNull();
      expect(svg.querySelector('svg')?.getAttribute('viewBox'), name).toMatch(/^0 0 24 24$/);
    }
  });

  it('searches current names and previous names without duplicate choices', () => {
    const service = new IconService();
    service.setSearchQuery('  store  ');
    expect(service.filteredIcons()).toEqual(['Shop']);
    service.setSearchQuery('Paw');
    expect(service.filteredIcons()).toEqual(['Paw']);
    service.setSearchQuery('');
    expect(service.filteredIcons()).toEqual(service.allIcons());
  });

  it.each(['unknown-icon', '', '__proto__', 'constructor', 'toString'])(
    'returns null for unsupported name %s',
    (name) => {
      const service = new IconService();
      expect(service.getIconByName(name)).toBeNull();
    }
  );
});
