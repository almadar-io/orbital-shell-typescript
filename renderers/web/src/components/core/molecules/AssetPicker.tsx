'use client';
/**
 * AssetPicker Molecule Component
 *
 * Catalog-driven asset chooser built on the GridPicker base. Maps an
 * AssetCatalog into picker cells and renders a kind-aware thumbnail: an
 * <img> for visual kinds, an Icon affordance for audio/model/other. Pure
 * presentational — the host supplies the catalog and owns the selected url.
 */

import React, { useCallback, useMemo } from 'react';
import type { AssetCatalog, AssetCatalogEntry } from '@almadar/core';
import { GridPicker, type PickerItem } from './GridPicker';
import { Icon } from '../../../core';

const THUMB_PX = 32;

export interface AssetPickerProps {
  /** Browsable asset catalog supplied by the host. */
  assets: AssetCatalog;
  /** Currently selected asset url (controlled highlight). */
  value?: string;
  /** Fired with the chosen asset's url. */
  onChange: (url: string) => void;
  /** Additional CSS classes applied to the root. */
  className?: string;
}

/** Kinds that resolve to an inline image preview. */
const IMAGE_KINDS: ReadonlySet<AssetCatalogEntry['kind']> = new Set([
  'image',
  'spritesheet',
  'scene',
  'portrait',
]);

/** Icon name per non-image kind. */
function iconForKind(kind: AssetCatalogEntry['kind']): string {
  if (kind === 'audio') return 'music';
  if (kind === 'model') return 'box';
  return 'file';
}

export const AssetPicker: React.FC<AssetPickerProps> = ({
  assets,
  value,
  onChange,
  className,
}) => {
  const byUrl = useMemo(() => {
    const map = new Map<string, AssetCatalogEntry>();
    for (const entry of assets) map.set(entry.url, entry);
    return map;
  }, [assets]);

  const items = useMemo<PickerItem[]>(
    () =>
      assets.map((entry) => ({
        id: entry.url,
        label: entry.name,
        category: entry.category,
      })),
    [assets],
  );

  const categories = useMemo(() => {
    const seen: string[] = [];
    for (const entry of assets) {
      if (!seen.includes(entry.category)) seen.push(entry.category);
    }
    return seen;
  }, [assets]);

  const renderThumbnail = useCallback(
    (item: PickerItem) => {
      const entry = byUrl.get(item.id);
      if (entry === undefined) return null;

      if (IMAGE_KINDS.has(entry.kind)) {
        return (
          <img
            src={entry.thumbnailUrl ?? entry.url}
            alt={entry.name}
            loading="lazy"
            width={THUMB_PX}
            height={THUMB_PX}
            style={{ width: THUMB_PX, height: THUMB_PX, objectFit: 'cover' }}
          />
        );
      }

      return <Icon name={iconForKind(entry.kind)} size="sm" />;
    },
    [byUrl],
  );

  return (
    <GridPicker
      items={items}
      value={value}
      onChange={onChange}
      categories={categories}
      renderThumbnail={renderThumbnail}
      cellSize={THUMB_PX}
      className={className}
    />
  );
};

AssetPicker.displayName = 'AssetPicker';
