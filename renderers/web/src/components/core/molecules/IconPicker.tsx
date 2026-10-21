'use client';
/**
 * IconPicker Molecule Component
 *
 * Searchable grid of every lucide icon, built on `GridPicker`. The item set is
 * enumerated once at module scope from the lucide-react exports and kebab-cased
 * to match the canonical names `Icon` resolves, so each cell renders its real
 * glyph via the family-aware `Icon` atom.
 */

import React, { useMemo } from 'react';
import * as LucideIcons from 'lucide-react';
import { Icon } from '../../../core';
import { GridPicker, type PickerItem } from './GridPicker';
import { useTranslate } from '../../../core';

/** Convert PascalCase lucide export name to canonical kebab-case: 'ShoppingCart' -> 'shopping-cart'. */
function pascalToKebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

/** Mirror of Icon.tsx's kebab->Pascal resolution, used to keep only round-trip-stable names. */
function kebabToPascal(name: string): string {
  return name
    .split('-')
    .map((part) => (/^\d+$/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('');
}

/**
 * Build the full item list once. Lucide exports each icon three ways
 * (`Camera`, `CameraIcon`, `LucideCamera`); we take only the bare PascalCase
 * component exports, kebab-case them, and drop any name that doesn't round-trip
 * back to the same export (so it actually resolves to its glyph, not the
 * HelpCircle fallback). All items share one coarse translated category.
 */
const ICON_ITEMS: PickerItem[] = (() => {
  const items: PickerItem[] = [];
  for (const [exportName, candidate] of Object.entries(LucideIcons)) {
    if (!/^[A-Z]/.test(exportName)) continue;
    if (exportName.endsWith('Icon')) continue;
    if (exportName.startsWith('Lucide')) continue;
    const isComponent =
      candidate !== null &&
      (typeof candidate === 'object' || typeof candidate === 'function') &&
      '$$typeof' in candidate;
    if (!isComponent) continue;
    const kebab = pascalToKebab(exportName);
    if (kebabToPascal(kebab) !== exportName) continue;
    items.push({ id: kebab, label: kebab, category: 'icons' });
  }
  return items;
})();

export interface IconPickerProps {
  /** Currently selected icon name (kebab-case). */
  value?: string;
  /** Fired with the chosen icon's kebab-case name. */
  onChange: (name: string) => void;
  /** Additional CSS classes applied to the root. */
  className?: string;
}

export const IconPicker: React.FC<IconPickerProps> = ({ value, onChange, className }) => {
  const { t } = useTranslate();
  const items = useMemo(() => {
    const category = t('iconPicker.category');
    return ICON_ITEMS.map((item) => ({ ...item, category }));
  }, [t]);

  return (
    <GridPicker
      items={items}
      value={value}
      onChange={onChange}
      searchPlaceholder={t('iconPicker.search')}
      renderThumbnail={(it) => <Icon name={it.id} />}
      cellSize={32}
      className={className}
    />
  );
};

IconPicker.displayName = 'IconPicker';
