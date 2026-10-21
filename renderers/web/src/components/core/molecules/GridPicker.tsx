'use client';
/**
 * GridPicker Molecule Component
 *
 * Reusable emoji-picker-style chooser: a search box, a row of category filter
 * chips, and a scrollable CSS-grid of fixed-size cells. Pure presentational —
 * the host owns the item list and the selected value; the molecule just filters,
 * highlights, and reports clicks via `onChange`.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { cn } from '../../../core';
import { Input } from '../../../core';
import { Badge } from '../../../core';
import { VStack, HStack } from '../../../core';
import { useTranslate } from '../../../core';

/**
 * Presentational item shape for a single grid cell. This is a UI-presentation
 * type, intentionally local — it is NOT a domain/asset type from @almadar/core.
 */
export interface PickerItem {
  /** Stable identity; emitted via `onChange`. */
  id: string;
  /** Human label — search term, cell title, and aria-label. */
  label: string;
  /** Category key used by the filter chips. */
  category: string;
  /** Extra search terms matched alongside the label (e.g. emoji keywords). */
  keywords?: string[];
}

export type GridPickerCellSize = 16 | 32 | 48;

export interface GridPickerProps {
  /** Items to render as grid cells. */
  items: PickerItem[];
  /** Currently selected item id (controlled highlight). */
  value?: string;
  /** Fired with the clicked/selected item's id. */
  onChange: (value: string) => void;
  /**
   * Category keys for the filter chip row. When omitted, the categories are
   * derived from the items. A translated "All" chip is always prepended.
   */
  categories?: string[];
  /** Placeholder for the search input. */
  searchPlaceholder?: string;
  /** Renders the visual content of a cell (e.g. an emoji glyph or an image). */
  renderThumbnail: (item: PickerItem) => React.ReactNode;
  /** Cell edge length in px. */
  cellSize?: GridPickerCellSize;
  /** Additional CSS classes applied to the root. */
  className?: string;
}

const ALL_CATEGORY = '__all__';

/** Max cells mounted at once; refine the search to reach the rest. */
const MAX_RENDERED = 300;

export const GridPicker: React.FC<GridPickerProps> = ({
  items,
  value,
  onChange,
  categories,
  searchPlaceholder,
  renderThumbnail,
  cellSize = 32,
  className,
}) => {
  const { t } = useTranslate();
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>(ALL_CATEGORY);
  const gridRef = useRef<HTMLDivElement>(null);

  const categoryChips = useMemo(() => {
    if (categories !== undefined) return categories;
    const seen: string[] = [];
    for (const item of items) {
      if (!seen.includes(item.category)) seen.push(item.category);
    }
    return seen;
  }, [categories, items]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return items.filter((item) => {
      const matchesCategory =
        activeCategory === ALL_CATEGORY || item.category === activeCategory;
      const matchesSearch =
        needle === '' ||
        item.label.toLowerCase().includes(needle) ||
        (item.keywords !== undefined &&
          item.keywords.some((k) => k.toLowerCase().includes(needle)));
      return matchesCategory && matchesSearch;
    });
  }, [items, search, activeCategory]);

  // Cap how many cells actually mount. With large sets (e.g. ~1500 lucide
  // icons) rendering every filtered cell mounts a thumbnail component per item
  // — heavy DOM + memory, multiplied by every picker on screen. Render a window
  // and prompt to refine the search for the rest.
  const visible = useMemo(() => filtered.slice(0, MAX_RENDERED), [filtered]);
  const truncated = filtered.length - visible.length;

  const select = useCallback(
    (item: PickerItem) => {
      onChange(item.id);
    },
    [onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
      const cells = gridRef.current?.querySelectorAll<HTMLButtonElement>(
        '[data-gridpicker-cell]',
      );
      if (cells === undefined || cells.length === 0) return;

      const columns = (() => {
        const grid = gridRef.current;
        if (grid === null) return 1;
        const style = window.getComputedStyle(grid);
        const cols = style.gridTemplateColumns.split(' ').filter(Boolean).length;
        return cols > 0 ? cols : 1;
      })();

      let next = -1;
      if (e.key === 'ArrowRight') next = index + 1;
      else if (e.key === 'ArrowLeft') next = index - 1;
      else if (e.key === 'ArrowDown') next = index + columns;
      else if (e.key === 'ArrowUp') next = index - columns;
      else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        select(filtered[index]);
        return;
      } else {
        return;
      }

      e.preventDefault();
      if (next >= 0 && next < cells.length) {
        cells[next].focus();
      }
    },
    [filtered, select],
  );

  return (
    <VStack gap="sm" className={cn('w-full', className)}>
      <Input
        type="search"
        icon="search"
        value={search}
        placeholder={searchPlaceholder}
        clearable
        onClear={() => setSearch('')}
        onChange={(e) => setSearch(e.target.value)}
      />

      {categoryChips.length > 0 && (
        <HStack gap="xs" wrap>
          <Badge
            variant={activeCategory === ALL_CATEGORY ? 'primary' : 'neutral'}
            size="sm"
            role="button"
            tabIndex={0}
            aria-pressed={activeCategory === ALL_CATEGORY}
            className="cursor-pointer"
            onClick={() => setActiveCategory(ALL_CATEGORY)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setActiveCategory(ALL_CATEGORY);
              }
            }}
          >
            {t('gridPicker.all')}
          </Badge>
          {categoryChips.map((category) => (
            <Badge
              key={category}
              variant={activeCategory === category ? 'primary' : 'neutral'}
              size="sm"
              role="button"
              tabIndex={0}
              aria-pressed={activeCategory === category}
              className="cursor-pointer"
              onClick={() => setActiveCategory(category)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setActiveCategory(category);
                }
              }}
            >
              {category}
            </Badge>
          ))}
        </HStack>
      )}

      <div
        ref={gridRef}
        role="listbox"
        className="grid gap-1 overflow-y-auto max-h-64 p-1"
        style={{
          gridTemplateColumns: `repeat(auto-fill, minmax(${cellSize}px, 1fr))`,
        }}
      >
        {visible.map((item, index) => {
          const selected = item.id === value;
          return (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={selected}
              aria-label={item.label}
              title={item.label}
              data-gridpicker-cell
              tabIndex={selected || (value === undefined && index === 0) ? 0 : -1}
              onClick={() => select(item)}
              onKeyDown={(e) => handleKeyDown(e, index)}
              className={cn(
                'flex items-center justify-center rounded-interactive',
                'transition-colors hover:bg-muted',
                'focus:outline-none focus:ring-1 focus:ring-ring',
                selected && 'bg-primary/10 ring-1 ring-primary',
              )}
              style={{ width: cellSize, height: cellSize }}
            >
              {renderThumbnail(item)}
            </button>
          );
        })}
      </div>

      {truncated > 0 && (
        <div className="px-1 text-xs text-muted-foreground">
          {t('gridPicker.moreRefine', { count: truncated })}
        </div>
      )}
    </VStack>
  );
};

GridPicker.displayName = 'GridPicker';
