'use client';
/**
 * DataGrid Molecule
 *
 * A simplified, schema-driven card grid for iterating over entity data.
 * Extracted from the CardGrid organism with all complexity removed:
 * no built-in search, sort, filter, pagination, selection, or bulk actions.
 *
 * Accepts `fields` config for per-field rendering control (icon, variant, format)
 * and `itemActions` for per-item event bus wiring.
 *
 * Uses atoms only internally: Box, VStack, HStack, Typography, Badge, Button, Icon.
 */
import { actionTestId, ACTION_OVERFLOW_TESTID } from '@almadar/core';
import React, { useCallback, useEffect, useState } from 'react';
import type { A11yProps, SkeletonSpec, EntityRow, EventKey, EventEmit, FieldValue } from '@almadar/core';
import { Skeleton } from "./Skeleton";
import type { ItemActionPayload, SelectionChangePayload } from '@almadar/core/patterns';
import { cn } from '../../../core';
import { enterClassName } from '../../../lib/enter';
import { ItemMoveScopeProvider, useItemMoves, useNewItemMoveScope } from '../../../lib/item-move';
import { useContentSurface } from '../../../core';
import type { SurfaceMode } from '@almadar/core';
import { entityRows } from '../../../lib/entityRows';
import { rowOpenControlProps, STRETCHED_CONTROL, STRETCHED_ABOVE } from '../../../core';
import { domPassthrough } from '../../../core';
import { formatValue, type BooleanLabels } from '../../../core';
import { resolveRelationCellDisplay } from '../../../lib/relationLabel';
import type { RelationOption } from './RelationSelect';
import { createLogger } from '@almadar/logger';

const dataGridLog = createLogger('almadar:ui:data-grid');
import { getNestedValue, resolveImageUrl } from '../../../lib/getNestedValue';
import { useEventBus } from '../../../core';
import { useRowActions, useRowActionPayload, useRowActionFire } from '../../../hooks/useRowActions';
import type { RowActionCondition, RowActionPayload } from '../../../lib/row-action-when';
import { useTranslate, useFormatContext } from '../../../core';
import { Box } from '../../../core';
import { VStack, HStack } from '../../../core';
import { Typography } from '../../../core';
import { EmptyState, type EmptyStateSlotProps } from './EmptyState';
import { Badge } from '../../../core';
import { ProgressBar } from '../../../core';
import { Button } from '../../../core';
import { Icon } from '../../../core';
import type { IconInput } from '../../../core';
import { InfiniteScrollSentinel } from '../../../core';
import { Menu } from './Menu';
import { useDataDnd, type DataDndProps } from './useDataDnd';
import type { DisplayField, UiError } from '../../../core';
import { badgeVariantFor, titleFieldOf, valueLabelFor } from '../../../lib/displayField';
import { Checkbox } from '../../../core';

// ── Field Definition ─────────────────────────────────────────────────

/** A DataGrid field is the shared display-field shape: every slot (title, badge, format, colour) is declared on it. */
export type DataGridField = DisplayField;

// ── Item Action Definition ───────────────────────────────────────────

export interface DataGridItemAction {
  /** Button label */
  label: string;
  /** Event name to emit (dispatched as UI:{event} with { row: itemData }).
   *  Optional when `navigatesTo` is set — a navigating action never emits. */
  event?: EventKey;
  /** Route to navigate to instead of emitting — `{{row.field}}`
   *  placeholders interpolate from the item row (CardGrid's contract). */
  navigatesTo?: string;
  /** Lucide icon name or component */
  icon?: IconInput;
  /** Button variant */
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  /** Per-row condition, authored as `(fn row <bool>)`: the row's button is drawn only when it returns true. Omit = always shown. */
  when?: RowActionCondition;
  /** Extra data the action sends, authored as `(fn row { key: <expr> })`; it emits `{ id, row }` plus these keys. */
  payload?: RowActionPayload;
}

// ── Props ────────────────────────────────────────────────────────────

/**
 * DataGrid — structured records grid rendering rows over configurable columns,
 * with sort, select, and drag-reorder.
 *
 * @capabilities admin table, records grid, user list, CRUD list, manage-records view, spreadsheet-style data grid, sortable columns
 * @fieldsContract display
 * @minWidth 200
 */
export interface DataGridProps extends DataDndProps, EmptyStateSlotProps, A11yProps {
  /**
   * Schema entity data — the collection of rows to render. pattern-sync tags
   * it `kind:"entity", cardinality:"collection"` so consumers bind the domain
   * entity without name-matching the prop.
   */
  entity: readonly EntityRow[];
  /**
   * Field definitions for rendering each card. The pattern contract in
   * `@almadar/core/patterns` documents `columns` as the wire-format alias the
   * compiler emits — both names resolve to the same shape here. Pass either.
   */
  fields?: readonly DataGridField[];
  /** Alias for `fields` — the compiler emits `columns` for field defs. */
  columns?: readonly DataGridField[];
  /** Per-item action buttons */
  itemActions?: readonly DataGridItemAction[];
  /** When set, clicking a card emits UI:{itemClickEvent} with { id, row }. Omit = cards are not clickable. */
  /** @entityRow row */
  itemClickEvent?: EventEmit<ItemActionPayload>;
  /** Max inline primary action buttons before the rest collapse into a "⋯" overflow menu. Omit = all inline. */
  maxInlineActions?: number;
  /** Lay items in a single horizontally-scrolling row (kanban columns) sized to `minCardWidth` instead of a wrapping grid. */
  scrollX?: boolean;
  /** Number of columns (uses auto-fit if omitted) */
  cols?: 1 | 2 | 3 | 4 | 5 | 6;
  /** Gap between cards */
  gap?: 'none' | 'sm' | 'md' | 'lg' | 'xl';
  /** Minimum card width in pixels (used when cols is not set, default 280) */
  minCardWidth?: number;
  /** Additional CSS classes */
  className?: string;
  /** Loading state */
  isLoading?: boolean;
  /** Skeleton drawn while loading, and the shape an empty slot shows while this element's server render is in flight (`none` opts out). */
  skeleton?: SkeletonSpec;
  /** Error state */
  error?: UiError | null;
  /** Entity field name containing an image URL for card thumbnails */
  imageField?: string;
  /** Enable multi-select with checkboxes */
  selectable?: boolean;
  /** Selection change event name (emits UI:{selectionEvent} with { selectedIds: string[] }) */
  selectionEvent?: EventEmit<SelectionChangePayload>;
  /** Enable infinite scroll loading */
  infiniteScroll?: boolean;
  /** Event emitted when more items needed: UI:{loadMoreEvent} */
  loadMoreEvent?: EventKey;
  /** Whether more items are available for infinite scroll */
  hasMore?: boolean;
  /** Render prop for custom per-card content. When provided, `fields` are
   *  ignored; `itemActions` render as a footer beneath the custom content. */
  children?: (item: EntityRow, index: number) => React.ReactNode;
  /**
   * Per-item render function (schema-level alias for children render prop).
   * In .orb schemas: ["fn", "item", { pattern tree with @item.field bindings }]
   * The compiler converts this to the children render prop.
   * In .lolo, author the per-item renderer as renderItem: (fn item <Component …={@item.field}/>), binding per-item fields via @item.field.
   * @deprecated Use children render prop in React code. This prop exists for pattern registry sync.
   */
  renderItem?: (item: EntityRow, index: number) => React.ReactNode;
  /** Entrance animation each card plays when it mounts; a card that changes place glides there. Lists rendered inside the grid share its movement, so a card moved between them glides across */
  itemEnter?: 'none' | 'fade' | 'rise' | 'scale' | 'slide';
  /** Max items to show before "Show More" button. Defaults to 0 (disabled). */
  pageSize?: number;
  /**
   * Layer 2 visual treatment — mirrors the `entity-table` look enum so
   * data-grid / data-list / entity-table share one knob name from authors.
   */
  look?: "dense" | "spacious" | "striped" | "borderless" | "card-rows";
  /** Content surface: `auto` paints the theme's surface behind this block unless it already sits on one (a card, dialog or another block); `none` opts out. */
  surface?: SurfaceMode;
  /** Relation display data: { fieldName: [{value, label}] } — injected
   *  server-side by the runtime (relation-option injection) or bound by
   *  compiled codegen; resolves stored foreign ids to display names for a
   *  field whose type is relation. Same contract DetailPanel takes. */
  relationsData?: Record<string, readonly RelationOption[]>;
}

// ── Helpers ──────────────────────────────────────────────────────────

function renderIconInput(icon: IconInput, props: React.ComponentProps<typeof Icon>): React.ReactElement {
  return typeof icon === 'string'
    ? <Icon name={icon} {...props} />
    : <Icon icon={icon} {...props} />;
}

const fieldLabel = (name: string): string => name;


const gapStyles: Record<string, string> = {
  none: 'gap-0',
  sm: 'gap-2',
  md: 'gap-4',
  lg: 'gap-6',
  xl: 'gap-8',
};

// ── Component ────────────────────────────────────────────────────────

// Layer 2 look styles for DataGrid — applied to the grid's child item
// containers via `[&>*]:` selectors. Tuned to be visibly distinct in
// Storybook: gap and per-item padding/radius/border do the work since
// the grid itself is just a flex/grid layout container.
const lookStyles: Record<NonNullable<DataGridProps['look']>, string> = {
  dense: 'gap-2 [&>*]:p-card-sm',
  spacious: 'gap-8 [&>*]:p-card-lg',
  striped: '[&>*:nth-child(even)]:bg-muted/30',
  borderless: '[&>*]:border-0 [&>*]:shadow-none',
  'card-rows': '[&>*]:shadow-elevation-card [&>*]:rounded-container [&>*]:border [&>*]:border-border [&>*]:p-card-md',
};

export function DataGrid({
  entity,
  emptyIcon,
  emptyTitle,
  emptyDescription,
  emptyAction,
  fields,
  columns,
  itemActions,
  itemClickEvent,
  maxInlineActions,
  scrollX = false,
  cols,
  gap = 'md',
  minCardWidth = 280,
  className,
  isLoading = false,
  skeleton = 'grid',
  error = null,
  imageField,
  selectable = false,
  selectionEvent,
  infiniteScroll,
  loadMoreEvent,
  hasMore,
  children,
  pageSize = 0,
  renderItem: schemaRenderItem,
  dragGroup,
  accepts,
  sortable,
  dropEvent,
  reorderEvent,
  positionEvent,
  dndItemIdField,
  dndRoot,
  look = 'dense',
  surface = 'auto',
  relationsData,
  itemEnter,
  ...rest
}: DataGridProps) {
  const eventBus = useEventBus();
  const moves = useItemMoves(itemEnter !== undefined && itemEnter !== 'none');
  // Lists nested in the cards share this scope; without its own `itemEnter` the grid's items join it, so a board column eases its height when its cards move.
  const nestedMoves = useNewItemMoveScope();
  const rowActions = useRowActions();
  const actionPayload = useRowActionPayload();
  const { fire: fireRowAction, isRowPending } = useRowActionFire<DataGridItemAction>();
  const { t } = useTranslate();
  const contentSurface = useContentSurface(surface);
  const fmt = useFormatContext();
  const boolLabels: BooleanLabels = { yes: t('common.yes'), no: t('common.no') };
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [visibleCount, setVisibleCount] = useState(pageSize || Infinity);

  // Honor the pattern-types alias: compiler emits `columns`, the React API
  // accepts `fields`. Either resolves to the same shape. Both `fields` and
  // `itemActions` coerce to an array first: a transient render can hand this
  // pure component an unresolved `@config.X` forward string, and rendering an
  // empty grid beats a TypeError on `.find`/`.filter` that trips the boundary.
  const fieldDefs: readonly DataGridField[] = (Array.isArray(fields) ? fields : undefined) ?? (Array.isArray(columns) ? columns : undefined) ?? [];
  const actionDefs: readonly DataGridItemAction[] = Array.isArray(itemActions) ? itemActions : [];

  const allDataRaw = entityRows(entity);
  const dnd = useDataDnd({
    items: allDataRaw as readonly EntityRow[],
    layout: 'grid',
    dragGroup,
    accepts,
    sortable,
    dropEvent,
    reorderEvent,
    positionEvent,
    dndItemIdField,
    dndRoot,
  });
  const allData = dnd.orderedItems;
  const data = pageSize > 0 ? allData.slice(0, visibleCount) : allData;
  const hasMoreLocal = pageSize > 0 && visibleCount < allData.length;

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (selectionEvent) {
        const payload: SelectionChangePayload = { selectedIds: Array.from(next) };
        eventBus.emit(`UI:${selectionEvent}`, payload);
      }
      return next;
    });
  }, [selectionEvent, eventBus]);

  const toggleAll = useCallback(() => {
    setSelectedIds((prev) => {
      const allIds = data.map((item, i) => (item.id as string) || String(i));
      const allSelected = allIds.length > 0 && allIds.every((id) => prev.has(id));
      const next = allSelected ? new Set<string>() : new Set(allIds);
      if (selectionEvent) {
        const payload: SelectionChangePayload = { selectedIds: Array.from(next) };
        eventBus.emit(`UI:${selectionEvent}`, payload);
      }
      return next;
    });
  }, [data, selectionEvent, eventBus]);

  // Separate fields by variant for smart card layout
  const titleField = titleFieldOf(fieldDefs);
  const badgeFields = fieldDefs.filter((f) => f.variant === 'badge' && f !== titleField);
  const bodyFields = fieldDefs.filter((f) => f !== titleField && !badgeFields.includes(f));

  // Card geometry: the title owns the header row. At most ONE explicit
  // `variant: 'primary'` action stays inline (zero when maxInlineActions is
  // 0); every ghost and danger action lives under the single "⋯" menu,
  // danger-styled there — so a fourth action can never starve the title to
  // a couple of characters (U-DATAGRID-ACTIONS-STARVE-CARD-TITLE,
  // 2026-08-28: /notes cards rendered View · Edit · History · Delete beside
  // the title). Wide row layouts (TableView, DataList rows) keep the
  // maxInlineActions cluster; a narrow card cannot afford it.
  const inlineCap = Math.min(maxInlineActions ?? 1, 1);
  const cardActionsFor = (itemData: EntityRow) => {
    const visible = rowActions(actionDefs, itemData);
    const inline = visible.filter((a) => a.variant === 'primary').slice(0, inlineCap);
    return {
      visible,
      inline,
      menu: visible.filter((a) => !inline.includes(a)),
    };
  };

  // navigatesTo-first with early return (mirrors CardGrid): a navigating
  // action must not also emit — the old order double-fired and emitted
  // `UI:undefined` for event-less actions. ONE firing path for inline
  // buttons and the overflow menu alike.
  const fireAction = (action: DataGridItemAction, itemData: EntityRow) => {
    if (action.navigatesTo) {
      const url = action.navigatesTo.replace(/\{\{row\.(\w+(?:\.\w+)*)\}\}/g, (_, field: string) =>
        String(itemData[field] ?? ''),
      );
      eventBus.emit('UI:NAVIGATE', { url, row: itemData });
      return;
    }
    fireRowAction(action, itemData, String(itemData.id ?? ""));
  };

  const handleActionClick = (action: DataGridItemAction, itemData: EntityRow) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fireAction(action, itemData);
  };


  // The compiled (orbital-rust) codegen path passes the per-item renderer
  // as the `renderItem` PROP (a real function); the interpreted/runtime
  // path passes it as `children` (a function-as-children render-prop).
  // Both are the same contract — accept either (C-DATAGRID-RENDERITEM-
  // IGNORED: `renderItem` was declared + typed but never invoked, so every
  // compiled DataGrid — every kanban board, gallery, card grid — silently
  // rendered zero items).
  const renderItemFn = typeof schemaRenderItem === 'function' ? schemaRenderItem : undefined;
  const itemRenderer = typeof children === 'function' ? children : renderItemFn;
  const hasRenderProp = typeof itemRenderer === 'function';

  // Hook order rule: all hooks must run on every render. Keeping this
  // useEffect above the early returns below prevents the "rendered fewer
  // hooks than expected" crash when `data` flips between empty and
  // populated across renders (e.g. search-as-you-type refetches).
  useEffect(() => {
    if (data.length > 0 && !hasRenderProp && fieldDefs.length === 0) {
      const schemaArr = Array.isArray(schemaRenderItem) ? (schemaRenderItem as readonly string[]) : null;
      const isFnLambda =
        schemaArr !== null &&
        schemaArr.length >= 3 &&
        (schemaArr[0] === 'fn' || schemaArr[0] === 'lambda');
      dataGridLog.warn('renderItem-unresolved', {
        rowCount: data.length,
        renderItemIsFnLambda: isFnLambda,
      });
    }
  }, [data, hasRenderProp, schemaRenderItem, fieldDefs]);

  // Grid template
  const gridTemplateColumns = cols
    ? undefined
    : `repeat(auto-fit, minmax(min(${minCardWidth}px, 100%), 1fr))`;

  // Columns follow the grid's own width (container queries on the grid root), not the
  // viewport: a board in a 950px area shows four columns on any screen, and a grid in a
  // scaled desktop-size demo or a simulated device keeps the layout its width allows.
  const colsClass = cols
    ? {
        1: 'grid-cols-1',
        2: '@[30rem]:grid-cols-2',
        3: '@[30rem]:grid-cols-2 @[42rem]:grid-cols-3',
        4: '@[30rem]:grid-cols-2 @[42rem]:grid-cols-3 @[56rem]:grid-cols-4',
        5: '@[30rem]:grid-cols-2 @[42rem]:grid-cols-3 @[64rem]:grid-cols-5',
        6: '@[30rem]:grid-cols-2 @[42rem]:grid-cols-3 @[72rem]:grid-cols-6',
      }[cols]
    : undefined;

  // One column is a list, not a gallery: one surface, divided rows.
  const asRows = cols === 1 && !scrollX && !hasRenderProp;

  // Loading state
  if (isLoading) {
    return <Skeleton spec={skeleton} className={className} />;
  }

  // Error state
  if (error) {
    return (
      <Box className="text-center py-8">
        <Typography variant="body" color="error">
          {error.message}
        </Typography>
      </Box>
    );
  }

  // Empty state — when DnD is enabled, keep the DropZoneShell mounted so
  // a kanban column with zero cards still accepts drops.
  if (data.length === 0) {
    const emptyNode = (
      <EmptyState
        icon={emptyIcon}
        title={emptyTitle || t('empty.noItems')}
        description={emptyDescription}
        actionLabel={emptyAction?.label}
        actionEvent={emptyAction?.event}
      />
    );
    return dnd.enabled ? <>{dnd.wrapContainer(emptyNode)}</> : emptyNode;
  }

  const allIds = data.map((item, i) => (item.id as string) || String(i));
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.has(id));
  const someSelected = selectedIds.size > 0;

  const idFieldName = dndItemIdField ?? 'id';
  return contentSurface.provide(dnd.wrapContainer(
    <ItemMoveScopeProvider value={nestedMoves}>
    <VStack gap="sm" className="@container w-full min-w-0" {...domPassthrough(rest)} data-item-move-root={moves.root}>
      {/* Selection toolbar */}
      {selectable && someSelected && (
        <HStack gap="sm" className="items-center px-2 py-2 bg-muted rounded-container">
          <Checkbox
            checked={allSelected}
            onChange={toggleAll}
            aria-label={t('aria.selectAll')}
          />
          <Typography variant="caption" className="font-semibold">
            {selectedIds.size} {t('common.selected')}
          </Typography>
        </HStack>
      )}

      <Box
        data-grid-layout={asRows ? 'rows' : 'cards'}
        data-item-move-root={nestedMoves.id}
        className={cn(
          asRows
            ? cn('flex flex-col divide-y divide-border', contentSurface.className && cn(contentSurface.className, 'overflow-hidden'))
            : cn('grid', gapStyles[gap], scrollX ? 'grid-flow-col overflow-x-auto snap-x snap-mandatory [&>*]:snap-start pb-2' : colsClass, lookStyles[look]),
          className,
        )}
        style={
          scrollX
            // Capped below the board width so, on a narrow screen, the next
            // column always peeks in — the cue that the board scrolls.
            ? { gridAutoFlow: 'column', gridAutoColumns: `minmax(min(${minCardWidth}px, 85%), 1fr)` }
            : gridTemplateColumns
              ? { gridTemplateColumns }
              : undefined
        }
      >
        {data.map((item, index) => {
          const itemData: EntityRow = item;
          const id = itemData.id || String(index);
          const isSelected = selectedIds.has(id);
          const rowAct = cardActionsFor(itemData);
          const handleCardClick = itemClickEvent
            ? () => eventBus.emit(`UI:${itemClickEvent}`, { id: itemData.id as string | number, row: itemData })
            : undefined;
          const stopCardClick = handleCardClick ? (e: React.MouseEvent) => e.stopPropagation() : undefined;
          const dndId = (itemData[idFieldName] as string | number | undefined) ?? `__idx_${index}`;
          const wrapDnd = (node: React.ReactNode): React.ReactNode =>
            dnd.isZone ? <dnd.SortableItem key={dndId} id={dndId}>{node}</dnd.SortableItem> : node;

          // Custom render-prop path: delegate card content to children;
          // itemActions still render as a footer so row-scoped events keep
          // their {id, row} payload regardless of the custom card body.
          if (hasRenderProp) {
            // Custom cards draw their own chrome, so a sibling action band
            // below them reads as detached furniture. Actions live INSIDE
            // the card's top-right corner instead: hover/focus-revealed on
            // pointer devices (Beauty §7 "action buttons fade in"), always
            // visible on coarse pointers where hover doesn't exist.
            return wrapDnd(
              <Box
                key={id}
                data-entity-row
                data-entity-id={id}
                data-item-key={id}
                data-item-move={moves.row ?? nestedMoves.id}
 data-row-pending={isRowPending(String(itemData.id ?? "")) || undefined}
 aria-busy={isRowPending(String(itemData.id ?? "")) || undefined}
                aria-current={isSelected ? 'true' : undefined}
                onClick={handleCardClick}
                className={cn('relative group/rowactions', handleCardClick && 'cursor-pointer', isSelected && 'ring-2 ring-primary rounded-container', enterClassName(itemEnter))}
              >
                {handleCardClick && (
                  <Box
                    {...rowOpenControlProps(true)}
                    aria-label={t('aria.openRow', { position: index + 1 })}
                    className="absolute inset-0 rounded-[inherit] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
                  />
                )}
                <Box className={cn(handleCardClick && 'relative')}>
                  {itemRenderer!(itemData, index)}
                </Box>
                {rowAct.visible.length > 0 && (
                  <Box onClick={stopCardClick} className="absolute top-2 right-2 z-10 opacity-0 group-hover/rowactions:opacity-100 focus-within:opacity-100 [@media(pointer:coarse)]:opacity-100 transition-opacity duration-fast">
                    {/* Card rule (same as the fields path): at most one
                        explicit primary inline, everything else behind one
                        kebab — an overlay cluster of labeled buttons sat on
                        the custom card's title. */}
                    <HStack gap="xs" className="rounded-container border border-border bg-card/95 backdrop-blur-sm shadow-elevation-popover surface-material p-0.5">
                      {rowAct.inline.map((action, idx) => (
                        <Button
                          key={idx}
                          variant="primary"
                          size="sm"
                          onClick={handleActionClick(action, itemData)}
                          data-testid={action.event ? actionTestId(action.event) : undefined}
                          data-row-id={String(itemData.id)}
                        >
                          {action.icon && renderIconInput(action.icon, { size: 'xs', className: 'mr-1' })}
                          {action.label}
                        </Button>
                      ))}
                      {rowAct.menu.length > 0 && (
                        <Menu
                          position="bottom-end"
                          trigger={
                            <Button variant="ghost" size="sm" aria-label={t('common.actions')} data-testid={ACTION_OVERFLOW_TESTID}>
                              <Icon name="more-horizontal" size="xs" />
                            </Button>
                          }
                          items={rowAct.menu.map((action) => ({
                            label: action.label,
                            icon: action.icon,
                            variant: action.variant === 'danger' ? ('danger' as const) : ('default' as const),
                            onClick: () => fireAction(action, itemData),
                          }))}
                        />
                      )}
                    </HStack>
                  </Box>
                )}
              </Box>
            );
          }

          // Default fields-based path
          const titleValue = getNestedValue(itemData, titleField?.name ?? '');
          const titleDisplay = resolveRelationCellDisplay(
            titleValue as FieldValue | undefined,
            titleField ? relationsData?.[titleField.name] : undefined,
          ) ?? (titleValue !== undefined && titleValue !== null ? String(titleValue) : undefined);

          const bodyContent = bodyFields.length > 0 ? (
          <VStack gap="xs">
            {bodyFields.filter((f) => f.variant === 'caption' && f.format !== 'boolean').map((field) => {
              const value = getNestedValue(itemData, field.name);
              if (value === undefined || value === null || value === '') return null;
              return (
                <Typography key={field.name} variant="small" color="secondary" className="line-clamp-2">
                  {resolveRelationCellDisplay(value as FieldValue, relationsData?.[field.name]) ?? formatValue(value, field.format, fmt)}
                </Typography>
              );
            })}
            <HStack gap="md" className="flex-wrap gap-y-1">
              {bodyFields.filter((f) => (f.variant !== 'caption' || f.format === 'boolean') && f.variant !== 'progress').map((field) => {
                const value = getNestedValue(itemData, field.name);
                if (value === undefined || value === null || value === '') return null;

                if (field.format === 'boolean') {
                  return (
                    <HStack key={field.name} gap="xs" className="items-center">
                      {field.icon && renderIconInput(field.icon, { size: 'xs', className: 'text-muted-foreground' })}
                      <Typography variant="caption" color="secondary">
                        {field.label ?? fieldLabel(field.name)}
                      </Typography>
                      <Badge variant={value ? 'success' : 'neutral'}>
                        {value ? boolLabels.yes : boolLabels.no}
                      </Badge>
                    </HStack>
                  );
                }

                return (
                  <HStack key={field.name} gap="xs" className="items-center">
                    {field.icon && renderIconInput(field.icon, { size: 'xs', className: 'text-muted-foreground' })}
                    {/* A declared icon names the value, so its label stays
                        screen-reader-only; without one the label shows — a
                        bare number ("13") names nothing. */}
                    <Typography variant="caption" color="secondary" className={field.icon ? "sr-only" : undefined}>
                      {(field.label ?? fieldLabel(field.name)) + ':'}
                    </Typography>
                    <Typography variant="small" color="secondary">
                      {resolveRelationCellDisplay(value as FieldValue, relationsData?.[field.name]) ?? formatValue(value, field.format, fmt)}
                    </Typography>
                  </HStack>
                );
              })}
            </HStack>
            {bodyFields.filter((f) => f.variant === 'progress').map((field) => {
              const value = getNestedValue(itemData, field.name);
              if (typeof value !== 'number') return null;
              return (
                <VStack key={field.name} gap="xs">
                  <HStack gap="xs" className="items-center">
                    {field.icon && renderIconInput(field.icon, { size: 'xs', className: 'text-muted-foreground' })}
                    <Typography variant="caption" color="secondary">
                      {field.label ?? fieldLabel(field.name)}
                    </Typography>
                  </HStack>
                  <ProgressBar value={value} max={100} />
                </VStack>
              );
            })}
          </VStack>
          ) : null;

          return wrapDnd(
            <Box
              key={id}
              data-entity-row
              data-entity-id={id}
              data-item-key={id}
              data-item-move={moves.row ?? nestedMoves.id}
 data-row-pending={isRowPending(String(itemData.id ?? "")) || undefined}
 aria-busy={isRowPending(String(itemData.id ?? "")) || undefined}
                aria-current={isSelected ? 'true' : undefined}
              onClick={handleCardClick}
              className={cn(
                'relative',
                enterClassName(itemEnter),
                asRows
                  ? 'flex flex-row items-center gap-3 px-card-md transition-colors duration-fast hover:bg-muted/50'
                  : cn(
                      // Each card is a surface; already on one, a hairline keeps the tiles apart.
                      contentSurface.className ?? 'rounded-container border border-border',
                      'hover:shadow-elevation-dialog hover:border-primary transition-all',
                      'flex flex-col',
                    ),
                handleCardClick && 'cursor-pointer',
                isSelected && (asRows ? 'bg-primary/5' : 'ring-2 ring-primary border-primary'),
              )}
            >
            {/* Card Image */}
            {imageField && (() => {
              const imgUrl = resolveImageUrl(getNestedValue(itemData, imageField));
              const mediaClass = asRows ? 'w-12 h-12 flex-shrink-0 overflow-hidden rounded-container' : 'w-full aspect-video overflow-hidden rounded-t-container';
              if (!imgUrl) {
                return (
                  <Box data-media-placeholder aria-hidden="true" className={cn(mediaClass, 'flex items-center justify-center bg-muted text-muted-foreground')}>
                    <Icon name="image" size={asRows ? 'sm' : 'lg'} />
                  </Box>
                );
              }
              return (
                <Box className={mediaClass}>
                  <img
                    src={imgUrl}
                    alt={titleDisplay ?? ''}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </Box>
              );
            })()}

            {/* Card Header: title + badges + the action cluster */}
            <Box className={cn(asRows ? 'flex-1 min-w-0 py-card-sm' : cn('p-4', bodyFields.length > 0 && 'pb-0'))}>
              <HStack gap="sm" className={cn('justify-between', asRows ? 'items-center' : 'items-start')}>
                {selectable && (
                  <Checkbox
                    checked={isSelected}
                    onChange={() => toggleSelection(id)}
                    onClick={(e: React.MouseEvent) => e.stopPropagation()}
                    className={cn("mt-1 flex-shrink-0", STRETCHED_ABOVE)}
                    aria-label={t('card.selectItem', { item: titleDisplay ?? t('card.itemFallback') })}
                  />
                )}
                <VStack gap="xs" className={cn('flex-1 min-w-0', asRows && 'flex-row flex-wrap items-center gap-x-2')}>
                  {titleDisplay !== undefined && (
                    <HStack gap="xs" className="items-center min-w-0">
                      {titleField?.icon && renderIconInput(titleField.icon, { size: 'sm', className: 'text-primary flex-shrink-0' })}
                      <Box
                        {...rowOpenControlProps(handleCardClick !== undefined)}
                        className={cn('min-w-0', handleCardClick && STRETCHED_CONTROL)}
                      >
                        <Typography
                          variant={titleField?.variant === 'h3' && !asRows ? 'h3' : 'h4'}
                          className={cn('font-semibold min-w-0', asRows ? 'truncate' : 'line-clamp-2 break-words')}
                        >
                          {titleDisplay}
                        </Typography>
                      </Box>
                    </HStack>
                  )}
                  {badgeFields.length > 0 && (
                    <HStack gap="xs" className="flex-wrap">
                      {badgeFields.map((field) => {
                        const val = getNestedValue(itemData, field.name);
                        if (val === undefined || val === null || val === '') return null;
                        return (
                          <HStack key={field.name} gap="xs" className="items-center">
                            {field.icon && renderIconInput(field.icon, { size: 'xs' })}
                            <Badge variant={badgeVariantFor(String(val), field.colorMap)}>
                              {resolveRelationCellDisplay(val as FieldValue, relationsData?.[field.name]) ?? valueLabelFor(formatValue(val, field.format, fmt), field.labels)}
                            </Badge>
                          </HStack>
                        );
                      })}
                    </HStack>
                  )}
                  {asRows && bodyContent && <Box className="basis-full min-w-0">{bodyContent}</Box>}
                </VStack>
                {/* Header action cluster: the title owns this row, so at
                    most ONE explicit primary action rides inline (icon-only
                    when it has an icon) and every other action — ghost and
                    danger alike — lives under the single "⋯" menu, danger-
                    styled there. Four inline buttons used to starve the
                    title to a couple of characters
                    (U-DATAGRID-ACTIONS-STARVE-CARD-TITLE). */}
                {rowAct.visible.length > 0 && (
                  <HStack gap="xs" onClick={stopCardClick} className={cn('flex-shrink-0', STRETCHED_ABOVE)}>
                    {rowAct.inline.map((action, idx) => (
                      <Button
                        key={idx}
                        variant="primary"
                        size="sm"
                        onClick={handleActionClick(action, itemData)}
                        data-testid={action.event ? actionTestId(action.event) : undefined}
                        data-row-id={String(itemData.id)}
                        aria-label={action.label}
                        title={action.label}
                        className={cn(action.icon && 'px-2')}
                      >
                        {action.icon
                          ? renderIconInput(action.icon, { size: 'xs' })
                          : action.label}
                      </Button>
                    ))}
                    {rowAct.menu.length > 0 && (
                      <Menu
                        position="bottom-end"
                        trigger={
                          <Button variant="ghost" size="sm" aria-label={t('common.actions')} data-testid={ACTION_OVERFLOW_TESTID}>
                            <Icon name="more-horizontal" size="xs" />
                          </Button>
                        }
                        items={rowAct.menu.map((action) => ({
                          label: action.label,
                          icon: action.icon,
                          variant: action.variant === 'danger' ? ('danger' as const) : ('default' as const),
                          onClick: () => fireAction(action, itemData),
                        }))}
                      />
                    )}
                  </HStack>
                )}
              </HStack>
            </Box>

            {/* Card Body: caption-variant fields read as prose (their value
                speaks for itself — a "Description" label over a description
                is noise); everything else is an inline `Label: value` pair in
                a wrapping meta row, the same convention DataList's default
                path uses. Never label-left/value-right across the card width:
                that separation breaks the label from its value. */}
            {!asRows && bodyContent && (
              <Box className="px-4 pt-2 pb-4 flex-1">
                {bodyContent}
              </Box>
            )}
          </Box>
        );
        })}
      </Box>
      {hasMoreLocal && (
        <Box className="flex justify-center py-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setVisibleCount((prev) => prev + (pageSize || 5))}
          >
            <Icon name="chevron-down" size="xs" className="mr-1" />
            {t('common.showMore')} ({t('common.remaining', { count: allData.length - visibleCount })})
          </Button>
        </Box>
      )}
      {infiniteScroll && loadMoreEvent && (
        <InfiniteScrollSentinel
          loadMoreEvent={loadMoreEvent}
          isLoading={isLoading}
          hasMore={hasMore}
        />
      )}
    </VStack>
    </ItemMoveScopeProvider>
  ));
};

DataGrid.displayName = 'DataGrid';
