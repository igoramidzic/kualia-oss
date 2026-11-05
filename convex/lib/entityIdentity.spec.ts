import { describe, expect, it } from 'vitest';
import { ENTITY_ICON_COLOR_IDS } from './entityIdentity';

describe('entity identity validators', () => {
  it('defines the expected fixed icon color ids', () => {
    expect(ENTITY_ICON_COLOR_IDS).toEqual([
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

  it('keeps the icon color id list at 20 options', () => {
    expect(ENTITY_ICON_COLOR_IDS).toHaveLength(20);
  });
});
