import emojilib from 'emojilib';
import type { PickerItem } from './GridPicker';

const { lib, ordered } = emojilib;

/**
 * The emojilib item list, built once. `ordered` keeps emojilib's curated display order, which
 * groups the set by category; the glyph itself is the stable id. Its own module so the emoji
 * dataset loads only when a picker opens.
 */
export const EMOJI_ITEMS: PickerItem[] = (() => {
  const items: PickerItem[] = [];
  for (const name of ordered) {
    const entry = lib[name];
    if (entry === undefined || entry.char === null || entry.char === '') continue;
    items.push({
      id: entry.char,
      label: name.replace(/_/g, ' '),
      category: entry.category.replace(/_/g, ' '),
      keywords: entry.keywords,
    });
  }
  return items;
})();
