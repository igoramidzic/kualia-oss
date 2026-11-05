import { describe, expect, it } from 'vitest';
import { buildOptimisticMerchantIdentityPatch, type MerchantIdentitySource } from './merchant-details';

const baseMerchant: MerchantIdentitySource = {
  logoUrl: 'https://cdn.example.com/current.png',
  rawLogoUrl: 'https://cdn.example.com/current.png',
  globalMerchantLogoUrl: 'https://cdn.example.com/default.png',
  visualIdentityMode: 'logo',
  iconName: 'Store',
  iconColorId: 'blue',
};

describe('buildOptimisticMerchantIdentityPatch', () => {
  it('switches to logo mode immediately when a custom logo is selected', () => {
    const patch = buildOptimisticMerchantIdentityPatch(
      { ...baseMerchant, visualIdentityMode: 'icon' },
      { logoUrl: 'https://cdn.example.com/new.png' }
    );

    expect(patch).toMatchObject({
      logoUrl: 'https://cdn.example.com/new.png',
      rawLogoUrl: 'https://cdn.example.com/new.png',
      visualIdentityMode: 'logo',
      iconName: 'Store',
      iconColorId: 'blue',
    });
  });

  it('resets to the default merchant logo optimistically', () => {
    const patch = buildOptimisticMerchantIdentityPatch(baseMerchant, { logoUrl: 'UNSET' });

    expect(patch.logoUrl).toBe('https://cdn.example.com/default.png');
    expect(patch.rawLogoUrl).toBeUndefined();
    expect(patch.visualIdentityMode).toBe('logo');
  });

  it('removes the logo optimistically', () => {
    const patch = buildOptimisticMerchantIdentityPatch(baseMerchant, { logoUrl: null });

    expect(patch.logoUrl).toBeUndefined();
    expect(patch.rawLogoUrl).toBeNull();
    expect(patch.visualIdentityMode).toBe('logo');
  });

  it('applies icon and color selections without waiting for the server', () => {
    const patch = buildOptimisticMerchantIdentityPatch(baseMerchant, {
      visualIdentityMode: 'icon',
      iconName: 'Coffee',
      iconColorId: 'emerald',
    });

    expect(patch).toMatchObject({
      logoUrl: 'https://cdn.example.com/current.png',
      rawLogoUrl: 'https://cdn.example.com/current.png',
      visualIdentityMode: 'icon',
      iconName: 'Coffee',
      iconColorId: 'emerald',
    });
  });
});
