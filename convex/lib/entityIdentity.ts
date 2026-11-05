import { v } from 'convex/values';

export const ENTITY_ICON_COLOR_IDS = [
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
] as const;

export type EntityIconColorId = (typeof ENTITY_ICON_COLOR_IDS)[number];

export const visualIdentityMode = v.union(v.literal('logo'), v.literal('icon'));

export const entityIconColorId = v.union(
  v.literal('slate'),
  v.literal('stone'),
  v.literal('zinc'),
  v.literal('red'),
  v.literal('orange'),
  v.literal('amber'),
  v.literal('yellow'),
  v.literal('lime'),
  v.literal('green'),
  v.literal('emerald'),
  v.literal('teal'),
  v.literal('cyan'),
  v.literal('sky'),
  v.literal('blue'),
  v.literal('indigo'),
  v.literal('violet'),
  v.literal('purple'),
  v.literal('fuchsia'),
  v.literal('pink'),
  v.literal('rose')
);
