import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';
import { THEME_SCALE_KEYS } from './theme-scale';

const scale = (keys: readonly string[]): string[] => [...keys];

/**
 * tailwind-merge that knows the preset's custom scales (`theme-scale.ts`), so
 * `h-auto` replaces `h-button-md` and `text-display-1` stays a font size.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      spacing: scale(THEME_SCALE_KEYS.spacing),
      borderRadius: scale(THEME_SCALE_KEYS.borderRadius),
    },
    classGroups: {
      h: [{ h: scale(THEME_SCALE_KEYS.height) }],
      'min-h': [{ 'min-h': scale(THEME_SCALE_KEYS.minHeight) }],
      w: [{ w: scale(THEME_SCALE_KEYS.width) }],
      'font-size': [{ text: scale(THEME_SCALE_KEYS.fontSize) }],
      shadow: [{ shadow: scale(THEME_SCALE_KEYS.boxShadow) }],
    },
  },
});

/**
 * Utility function to merge Tailwind CSS classes
 * Combines clsx for conditional classes with tailwind-merge to handle conflicts
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
