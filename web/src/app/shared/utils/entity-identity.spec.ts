import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_BANK_ACCOUNT_ICON_NAME,
  DEFAULT_MERCHANT_ICON_NAME,
  ENTITY_ICON_COLORS,
  getEntityIconColor,
  randomEntityIconColorId,
} from './entity-identity';

describe('entity identity helpers', () => {
  it('defines the expected fixed color palette', () => {
    expect(ENTITY_ICON_COLORS).toHaveLength(20);
    expect(ENTITY_ICON_COLORS.map((color) => color.id)).toEqual([
      'slate',
      'stone',
      'zinc',
      'red',
      'orange',
      'amber',
      'yellow',
      'lime',
      'green',
      'emerald',
      'teal',
      'cyan',
      'sky',
      'blue',
      'indigo',
      'violet',
      'purple',
      'fuchsia',
      'pink',
      'rose',
    ]);
  });

  it('resolves a saved color and falls back to blue when missing', () => {
    expect(getEntityIconColor('emerald')).toMatchObject({
      background: '#d1fae5',
      foreground: '#047857',
    });
    expect(getEntityIconColor(null).id).toBe('blue');
    expect(getEntityIconColor(undefined).id).toBe('blue');
  });

  it('returns a palette color id at random', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.7);

    expect(randomEntityIconColorId()).toBe('indigo');

    randomSpy.mockRestore();
  });

  it('defines entity-specific default icon names', () => {
    expect(DEFAULT_MERCHANT_ICON_NAME).toBe('Store');
    expect(DEFAULT_BANK_ACCOUNT_ICON_NAME).toBe('Landmark');
  });
});
