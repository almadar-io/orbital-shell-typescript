/**
 * The custom scale keys `tailwind-preset.cjs` adds on top of Tailwind's stock
 * scales, by theme group. `cn` registers them with tailwind-merge so a caller's
 * class replaces a component's default of the same group; `cn.test.ts` fails
 * when the preset gains a key that is missing here.
 */
export const THEME_SCALE_KEYS = {
  height: ['button-sm', 'button-md', 'button-lg', 'input-sm', 'input-md', 'input-lg', 'row-compact', 'row-normal', 'row-spacious', 'icon-default'],
  minHeight: ['button-sm', 'button-md', 'button-lg', 'input-sm', 'input-md', 'input-lg', 'row-compact', 'row-normal', 'row-spacious'],
  width: ['icon-default'],
  fontSize: ['display-1', 'display-2'],
  borderRadius: ['container', 'interactive', 'pill'],
  boxShadow: ['elevation-card', 'elevation-popover', 'elevation-dialog', 'elevation-toast', 'elevation-interactive', 'elevation-pressed'],
  spacing: ['card-sm', 'card-md', 'card-lg', 'dialog', 'section'],
} as const;
