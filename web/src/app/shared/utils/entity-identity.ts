export type VisualIdentityMode = 'logo' | 'icon';

export type EntityIconColorId =
  | 'slate'
  | 'stone'
  | 'zinc'
  | 'red'
  | 'orange'
  | 'amber'
  | 'yellow'
  | 'lime'
  | 'green'
  | 'emerald'
  | 'teal'
  | 'cyan'
  | 'sky'
  | 'blue'
  | 'indigo'
  | 'violet'
  | 'purple'
  | 'fuchsia'
  | 'pink'
  | 'rose';

export interface EntityIconColor {
  readonly id: EntityIconColorId;
  readonly label: string;
  readonly background: string;
  readonly foreground: string;
}

export const ENTITY_ICON_COLORS: readonly EntityIconColor[] = [
  { id: 'slate', label: 'Slate', background: '#f1f5f9', foreground: '#334155' },
  { id: 'stone', label: 'Stone', background: '#f5f5f4', foreground: '#44403c' },
  { id: 'zinc', label: 'Zinc', background: '#f4f4f5', foreground: '#3f3f46' },
  { id: 'red', label: 'Red', background: '#fee2e2', foreground: '#b91c1c' },
  { id: 'orange', label: 'Orange', background: '#ffedd5', foreground: '#c2410c' },
  { id: 'amber', label: 'Amber', background: '#fef3c7', foreground: '#b45309' },
  { id: 'yellow', label: 'Yellow', background: '#fef9c3', foreground: '#a16207' },
  { id: 'lime', label: 'Lime', background: '#ecfccb', foreground: '#4d7c0f' },
  { id: 'green', label: 'Green', background: '#dcfce7', foreground: '#15803d' },
  { id: 'emerald', label: 'Emerald', background: '#d1fae5', foreground: '#047857' },
  { id: 'teal', label: 'Teal', background: '#ccfbf1', foreground: '#0f766e' },
  { id: 'cyan', label: 'Cyan', background: '#cffafe', foreground: '#0e7490' },
  { id: 'sky', label: 'Sky', background: '#e0f2fe', foreground: '#0369a1' },
  { id: 'blue', label: 'Blue', background: '#dbeafe', foreground: '#1d4ed8' },
  { id: 'indigo', label: 'Indigo', background: '#e0e7ff', foreground: '#4338ca' },
  { id: 'violet', label: 'Violet', background: '#ede9fe', foreground: '#6d28d9' },
  { id: 'purple', label: 'Purple', background: '#f3e8ff', foreground: '#7e22ce' },
  { id: 'fuchsia', label: 'Fuchsia', background: '#fae8ff', foreground: '#a21caf' },
  { id: 'pink', label: 'Pink', background: '#fce7f3', foreground: '#be185d' },
  { id: 'rose', label: 'Rose', background: '#ffe4e6', foreground: '#be123c' },
] as const;

export const DEFAULT_MERCHANT_ICON_NAME = 'Store';
export const DEFAULT_BANK_ACCOUNT_ICON_NAME = 'Landmark';

const DEFAULT_COLOR = ENTITY_ICON_COLORS.find((color) => color.id === 'blue') ?? ENTITY_ICON_COLORS[0];

export function getEntityIconColor(colorId: EntityIconColorId | null | undefined): EntityIconColor {
  return ENTITY_ICON_COLORS.find((color) => color.id === colorId) ?? DEFAULT_COLOR;
}

export function randomEntityIconColorId(): EntityIconColorId {
  const index = Math.floor(Math.random() * ENTITY_ICON_COLORS.length);
  return ENTITY_ICON_COLORS[index].id;
}
