'use client';
/**
 * TableView Molecule
 *
 * A simplified, schema-driven column table for iterating over entity data.
 * The table-shaped sibling of DataList (rows) and DataGrid (cards): same
 * `entity` + `columns`/`fields` + `itemActions` contract and the same
 * `useDataDnd` drag-to-reorder machinery, rendered as aligned columns with a
 * header. All complexity is opt-in: selection, drag-reorder, and per-column
 * sorting are each enabled by their own props and emit via the event bus.
 *
 * Uses atoms only internally: Box, VStack, HStack, Typography, Badge, Button,
 * Icon, Checkbox, Divider.
 */
import { ACTION_OVERFLOW_TESTID } from '@almadar/core';
import React from 'react';
import type { A11yProps, SkeletonSpec, EntityRow, EntityWith, FieldValue, EventKey, EventEmit } from '@almadar/core';
import { Skeleton } from "./Skeleton";
import type { ItemActionPayload, SelectionChangePayload } from '@almadar/core/patterns';
import { cn } from '../../../core';
import { useContentSurface } from '../../../core';
import type { SurfaceMode } from '@almadar/core';
import { entityRows } from '../../../lib/entityRows';
import { formatValue, type FormatContext } from '../../../core';
import { resolveRelationCellDisplay } from '../../../lib/relationLabel';
import type { RelationOption } from './RelationSelect';
import { createLogger } from '@almadar/logger';

const tableViewLog = createLogger('almadar:ui:table-view');
import { getNestedValue } from '../../../lib/getNestedValue';
import { groupRows } from '../../../lib/groupRows';
import { useEventBus } from '../../../core';
import { useRowActions, useRowActionFire } from '../../../hooks/useRowActions';
import type { RowActionCondition, RowActionPayload } from '../../../lib/row-action-when';
import { useTranslate, useFormatContext } from '../../../core';
import { Box } from '../../../core';
import { VStack, HStack } from '../../../core';
import { Typography } from '../../../core';
import { Badge } from '../../../core';
import { Button } from '../../../core';
import { Icon } from '../../../core';
import type { IconInput } from '../../../core';
import { Checkbox } from '../../../core';
import { Divider } from '../../../core';
import { Menu } from './Menu';
import { EmptyState, type EmptyStateSlotProps } from './EmptyState';
import { useDataDnd, type DataDndProps } from './useDataDnd';
import type { BadgeColor, UiError } from '../../../core';
import { badgeVariantFor, valueLabelFor } from '../../../lib/displayField';
import { pressableProps, rowOpenControlProps, STRETCHED_CONTROL, STRETCHED_ABOVE } from '../../../core';
import { domPassthrough } from '../../../core';

// ── Column Definition ────────────────────────────────────────────────

export interface TableViewColumn {
  /** Stable column key (React key + default value lookup). */
  key: string;
  /** Entity field to read (dot-notation ok). Defaults to `key`. */
  field?: string;
  /** Header cell text. Falls back to `label`, then the `key` as written. */
  header?: string;
  /** Accessibility / fallback label. */
  label?: string;
  /** CSS grid track size for this column (e.g. "7rem", "minmax(10rem, 1.5fr)",
   *  "1fr"). Shared across header + body so columns align. Defaults to
   *  "minmax(0, 1fr)" (equal flexible share). */
  width?: string;
  /** Horizontal alignment of the column's cells. */
  align?: 'left' | 'center' | 'right';
  /** Extra cell classes (e.g. "font-mono tabular-nums truncate"). */
  className?: string;
  /** Render the cell value with the given font weight. */
  weight?: 'normal' | 'medium' | 'semibold';
  /** Value formatting hint. `badge` renders a status Badge. */
  format?: 'badge' | 'date' | 'currency' | 'number' | 'percent' | 'boolean';
  /** Badge colour per exact value (for `format: 'badge'`); unmapped values are neutral. */
  colorMap?: Readonly<Record<string, BadgeColor>>;
  /** Display text per exact value (for `format: 'badge'`); unmapped values show as stored */
  labels?: Readonly<Record<string, string>>;
  /** `h3`/`h4` marks the row's title column: on narrow tables it heads the stacked card, unlabelled */
  variant?: 'h3' | 'h4';
  /** Lucide icon name or component shown before the header label. */
  icon?: IconInput;
  /** Allow click-to-sort on this column's header (emits `sortEvent`). */
  sortable?: boolean;
}

// ── Item Action Definition ───────────────────────────────────────────

export interface TableViewItemAction {
  /** Button label. */
  label: string;
  /** Event name to emit (dispatched as UI:{event} with { id, row }). */
  event: EventKey;
  /** Lucide icon name or component. */
  icon?: IconInput;
  /** Button variant. */
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  /** Per-row condition, authored as `(fn row <bool>)`: the row's menu item is drawn only when it returns true. Omit = always shown. */
  when?: RowActionCondition;
  /** Extra data the action sends, authored as `(fn row { key: <expr> })`; it emits `{ id, row }` plus these keys. */
  payload?: RowActionPayload;
}

// ── Props ────────────────────────────────────────────────────────────

/**
 * TableView — sortable, selectable data table rendering rows over configurable
 * columns, with inline row actions and grouping.
 *
 * @capabilities admin console table, records list, CRUD data table, user list, manage-users grid, sortable columns, row selection with bulk actions, grouped list view
 * @fieldsContract display
 * @minWidth 240
 */
export interface TableViewProps extends DataDndProps, EmptyStateSlotProps, A11yProps {
  /** Schema entity data — the collection of rows to render. */
  entity: readonly EntityRow[];
  /** Column definitions. The compiler emits `columns`; `fields` is the alias. */
  columns?: readonly TableViewColumn[];
  /** Alias for `columns`. */
  fields?: readonly TableViewColumn[];
  /** Content surface: `auto` paints the theme's surface behind this block unless it already sits on one (a card, dialog or another block); `none` opts out. */
  surface?: SurfaceMode;
  /** Per-row actions, collected under a trailing kebab overflow menu. */
  itemActions?: readonly TableViewItemAction[];
  /** @deprecated Row actions always render as a kebab menu now (UX doctrine: row actions behind an overflow menu; a pinned inline button strip paints over cells during horizontal scroll). Accepted and ignored. */
  maxInlineActions?: number;
  /** When set, the whole row is clickable and emits UI:{itemClickEvent} with
   *  { id, row } (action-button clicks stopPropagation so they still win).
   *  Mirrors DataList's contract. Omit = rows are not clickable. */
  /** @entityRow row */
  itemClickEvent?: EventEmit<ItemActionPayload>;
  /** Render a leading checkbox column. Selection changes emit `selectEvent`. */
  selectable?: boolean;
  /** Event emitted on selection change: UI:{selectEvent} with { selectedIds }. */
  selectEvent?: EventEmit<SelectionChangePayload>;
  /** Currently-selected ids (controlled). Falls back to local state when omitted. */
  selectedIds?: readonly string[];
  /** Event emitted on sortable-header click: UI:{sortEvent} with { column, direction }. */
  sortEvent?: EventEmit<{ column: string; direction: 'asc' | 'desc' }>;
  /** Current sort column (display hint for the active header arrow). */
  sortColumn?: string;
  /** Current sort direction (display hint). */
  sortDirection?: 'asc' | 'desc';
  /** Additional CSS classes applied to the table root. */
  className?: string;
  /** Message shown when there are no rows. */
  emptyMessage?: string;
  /** Loading state. */
  isLoading?: boolean;
  /** Skeleton drawn while loading, and the shape an empty slot shows while this element's server render is in flight (`none` opts out). */
  skeleton?: SkeletonSpec;
  /** Error state. */
  error?: UiError | null;
  /** Group rows under section headers by a field value. */
  groupBy?: string;
  /** Max rows before a "Show More" button. Defaults to 0 (show all). */
  pageSize?: number;
  /**
   * Custom per-row render. When provided, the whole row content is delegated
   * to this function (columns are ignored for the body; the header still
   * renders). Mirrors DataList's children render prop.
   */
  children?: (item: EntityRow, index: number) => React.ReactNode;
  /**
   * Per-row render function (schema alias). In .orb: ["fn","item",{...}].
   * The compiler converts this to the children render prop.
   * In .lolo, author the per-row renderer as renderItem: (fn item <Component …={@item.field}/>), binding per-item fields via @item.field.
   * @deprecated Use children in React code; exists for pattern registry sync.
   */
  renderItem?: (item: EntityRow, index: number) => React.ReactNode;
  /**
   * Layer 2 visual treatment — mirrors the data-list / entity-table look enum
   * so authors share one knob name across row renderers.
   */
  look?: 'dense' | 'spacious' | 'striped' | 'borderless' | 'bordered';
  /** Relation display data: { fieldName: [{value, label}] } — injected
   *  server-side by the runtime (relation-option injection) or bound by
   *  compiled codegen; resolves stored foreign ids to display names for a
   *  column whose field is relation-typed. Same contract DetailPanel takes. */
  relationsData?: Record<string, readonly RelationOption[]>;
}

// ── Helpers ──────────────────────────────────────────────────────────

function renderIconInput(icon: IconInput, props: React.ComponentProps<typeof Icon>): React.ReactElement {
  return typeof icon === 'string'
    ? <Icon name={icon} {...props} />
    : <Icon icon={icon} {...props} />;
}

function columnLabel(col: TableViewColumn): string {
  return col.header ?? col.label ?? col.key;
}

function asFieldValue(v: ReturnType<typeof getNestedValue>): FieldValue | undefined {
  if (v === undefined || v === null) return v as null | undefined;
  const t = typeof v;
  if (t === 'string' || t === 'number' || t === 'boolean') return v as FieldValue;
  if (v instanceof Date) return v;
  if (Array.isArray(v)) return v as FieldValue;
  if (t === 'object') return v as FieldValue;
  return undefined;
}

const formatCell = (
  value: FieldValue | undefined,
  format: TableViewColumn['format'] | undefined,
  relationOptions: readonly RelationOption[] | undefined,
  fmt: FormatContext,
): string => {
  // A hydrated relation row (or array of rows/ids, from `include:` hydration)
  // reads by its name/title/label; a bare foreign id resolves through the
  // column's injected `relationsData` options — never "[object Object]" or a
  // raw id when a label is knowable.
  const relationDisplay = resolveRelationCellDisplay(value, relationOptions);
  if (relationDisplay !== undefined) return relationDisplay;
  return formatValue(value, format, fmt);
};

/** Ceiling on a measured column floor, so one prose column can't starve the rest. */
const MAX_MEASURED_COL_CH = 32;

/** Horizontal padding a Badge adds around its label, in approximate `ch`. */
const BADGE_CHROME_CH = 4;

// Alignment applies to the column layout only; a stacked (narrow) row lays
// each cell out as label ⟷ value instead.
const alignClass: Record<NonNullable<TableViewColumn['align']>, string> = {
  left: '@sm/table:justify-start @sm/table:text-left',
  center: '@sm/table:justify-center @sm/table:text-center',
  right: '@sm/table:justify-end @sm/table:text-right',
};

const weightClass: Record<NonNullable<TableViewColumn['weight']>, string> = {
  normal: '',
  medium: 'font-medium',
  semibold: 'font-semibold',
};

interface LookConfig {
  /** Cell padding for body rows. */
  rowPad: string;
  /** Cell padding for the header row. */
  headPad: string;
  /** Stripe even rows. */
  striped: boolean;
  /** Hairline between rows. */
  divider: boolean;
}

const LOOKS: Record<NonNullable<TableViewProps['look']>, LookConfig> = {
  dense: { rowPad: 'px-card-md py-2', headPad: 'px-card-md py-2', striped: false, divider: true },
  spacious: { rowPad: 'px-card-lg py-card-md', headPad: 'px-card-lg py-card-sm', striped: false, divider: true },
  striped: { rowPad: 'px-card-md py-card-sm', headPad: 'px-card-md py-card-sm', striped: true, divider: false },
  borderless: { rowPad: 'px-card-md py-card-sm', headPad: 'px-card-md py-card-sm', striped: false, divider: false },
  bordered: { rowPad: 'px-card-md py-card-sm', headPad: 'px-card-md py-card-sm', striped: false, divider: true },
};

// ── Component ────────────────────────────────────────────────────────

export function TableView({
  entity,
  columns,
  fields,
  itemActions,
  itemClickEvent,
  selectable = false,
  selectEvent,
  selectedIds,
  sortEvent,
  sortColumn,
  sortDirection,
  className,
  emptyMessage,
  emptyIcon,
  emptyTitle,
  emptyDescription,
  emptyAction,
  isLoading = false,
  skeleton = 'table',
  error = null,
  groupBy,
  pageSize = 0,
  children,
  renderItem: _schemaRenderItem,
  look = 'dense',
  surface = 'auto',
  // DnD props consumed by useDataDnd.
  dragGroup,
  accepts,
  sortable,
  dropEvent,
  reorderEvent,
  positionEvent,
  dndItemIdField,
  dndRoot,
  relationsData,
  ...rest
}: TableViewProps) {
  const eventBus = useEventBus();
  const rowActions = useRowActions();
  const { t } = useTranslate();
  const fmt = useFormatContext();
  const [visibleCount, setVisibleCount] = React.useState(pageSize > 0 ? pageSize : Infinity);
  const [localSelected, setLocalSelected] = React.useState<ReadonlySet<string>>(new Set());

  // Both `columns`/`fields` and `itemActions` coerce to an array first: a
  // transient render can hand this pure component an unresolved `@config.X`
  // forward STRING, and `"@config.itemActions".length > 0` is true — so a bare
  // truthiness check then throws on `.map`. Mirrors DataGrid.tsx, but keeps
  // TableView's `columns`-first precedence (DataGrid is `fields`-first);
  // do not "harmonize" the two.
  const colDefs: readonly TableViewColumn[] =
    (Array.isArray(columns) ? columns : undefined) ?? (Array.isArray(fields) ? fields : undefined) ?? [];
  const actionDefs: readonly TableViewItemAction[] = Array.isArray(itemActions) ? itemActions : [];
  // UX doctrine (see the maxInlineActions prop doc): row actions ALWAYS live
  // under the single "⋯" menu. An inline strip cannot fit the fixed 3rem
  // actions track — the buttons overflow and the pinned opaque cell paints
  // over the data columns beside it (observed 2026-09-17 on std-browse
  // dense tables, e.g. PF Timesheets: View/Edit covering the Status pill).
  const { fire: fireRowAction, isRowPending } = useRowActionFire<TableViewItemAction>();
  const allDataRaw = entityRows(entity);

  const dnd = useDataDnd({
    items: allDataRaw as readonly EntityRow[],
    layout: 'list',
    dragGroup,
    accepts,
    sortable,
    dropEvent,
    reorderEvent,
    positionEvent,
    dndItemIdField,
    dndRoot,
  });
  const ordered = dnd.orderedItems;
  const data = pageSize > 0 ? ordered.slice(0, visibleCount) : ordered;
  const hasMore = pageSize > 0 && visibleCount < ordered.length;
  const hasRenderProp = typeof children === 'function';
  const idField = dndItemIdField ?? 'id';

  // `tableViewLog` was declared and never called, so every diagnosis of this
  // component started blind. Hook order is safe: there are no early returns.
  React.useEffect(() => {
    tableViewLog.debug('render', {
      rowCount: data.length,
      colCount: colDefs.length,
      look,
      isLoading: Boolean(isLoading),
      hasError: Boolean(error),
      dnd: dnd.enabled,
    });
    if (data.length > 0 && !hasRenderProp && colDefs.length === 0) {
      tableViewLog.warn('columns-unresolved', {
        rowCount: data.length,
        columnsIsArray: Array.isArray(columns),
        fieldsIsArray: Array.isArray(fields),
      });
    }
  }, [data, colDefs, look, isLoading, error, dnd.enabled, hasRenderProp, columns, fields]);

  const selected = selectedIds ? new Set(selectedIds) : localSelected;

  const emitSelection = (next: ReadonlySet<string>) => {
    if (!selectedIds) setLocalSelected(next);
    if (selectEvent) {
      const payload: SelectionChangePayload = { selectedIds: Array.from(next) };
      eventBus.emit(`UI:${selectEvent}`, payload);
    }
  };
  const allSelected = selectable && data.length > 0 && data.every((r, i) => selected.has(String(r[idField] ?? i)));
  const toggleAll = () => {
    if (allSelected) emitSelection(new Set());
    else emitSelection(new Set(data.map((r, i) => String(r[idField] ?? i))));
  };
  const toggleRow = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    emitSelection(next);
  };

  const handleSort = (col: TableViewColumn) => {
    if (!col.sortable || !sortEvent) return;
    const dir = sortColumn === (col.field ?? col.key) && sortDirection === 'asc' ? 'desc' : 'asc';
    eventBus.emit(`UI:${sortEvent}`, { column: col.field ?? col.key, direction: dir });
  };

  const handleRowClick = (row: EntityRow) => () => {
    if (!itemClickEvent) return;
    const payload: ItemActionPayload = {
      id: row.id as string | number,
      row: row as ItemActionPayload['row'],
    };
    eventBus.emit(`UI:${itemClickEvent}`, payload);
  };

  // A bare `minmax(0, 1fr)` splits width evenly, so a long value (an email) is
  // truncated while a short one (a badge) wastes its share. The floor can't be
  // `min-content`/`auto` — each row is its own grid, so a content-measured track
  // differs per row and the columns drift. Measuring the whole visible page
  // instead yields one floor that is identical for the header and every row, so
  // alignment holds. Must run BEFORE the loading/error/empty early returns:
  // a hook below them changes the hook count when data arrives (React #300).
  const colFloors = React.useMemo(
    () => colDefs.map((col) => {
      const longest = data.reduce((widest, row) => {
        const cell = formatCell(asFieldValue(getNestedValue(row, col.field ?? col.key)), col.format, relationsData?.[col.field ?? col.key], fmt);
        return Math.max(widest, cell.length);
      }, columnLabel(col).length);
      // A badge wraps its text in padding, so the raw character count
      // under-measures the track it actually needs.
      const chrome = col.format === 'badge' ? BADGE_CHROME_CH : 0;
      return Math.min(longest + chrome, MAX_MEASURED_COL_CH);
    }),
    [colDefs, data, relationsData, fmt],
  );

  // The header is CHROME, not data. Loading / error / empty each used to return
  // a header-less node, so any render where `entity` resolved to `[]` dropped
  // the column headers and a populated render put them back — which is the
  // "columns appear momentarily then disappear" flicker. DataTable.tsx already
  // avoids this by keeping <thead> and putting the empty check inside the table;
  // the three states now collapse to one status row rendered UNDER the header.
  const statusNode = isLoading ? (
    <Skeleton spec={skeleton} />
  ) : error ? (
    <Box className="text-center py-8">
      <Typography variant="body" color="error">{error.message}</Typography>
    </Box>
  ) : data.length === 0 ? (
    <EmptyState
      icon={emptyIcon}
      title={emptyTitle || emptyMessage || t('empty.noItems')}
      description={emptyDescription}
      actionLabel={emptyAction?.label}
      actionEvent={emptyAction?.event}
    />
  ) : null;

  const contentSurface = useContentSurface(surface);
  const lk = LOOKS[look];
  const openColKey = (colDefs.find((c) => c.variant === 'h3' || c.variant === 'h4') ?? colDefs[0])?.key;

  // Shared CSS-grid track template so columns line up across every row
  // (flex-per-row sizes each row independently → misaligned columns). The
  // actions track must be a FIXED size, not `auto`: each row is its own grid,
  // so an `auto` track measures that row's own content — empty (0) in the
  // header, wide in the body — and the `fr` data columns then split different
  // leftover space per row, drifting the header labels off their columns. A
  // fixed width is identical in header and body, so columns stay aligned.
  const hasActions = actionDefs.length > 0;
  // All row actions live under one kebab menu: an inline button strip needs a
  // wide fixed track that, pinned, paints over data cells during horizontal
  // scroll (looked broken); a single 3rem icon cell with a hairline edge is
  // the standard overflow affordance and covers nothing meaningful.
  const actionsTrack = hasActions ? '3rem' : null;
  const gridTemplateColumns = [
    selectable ? 'auto' : null,
    ...colDefs.map((c, i) => c.width ?? `minmax(${colFloors[i]}ch, 1fr)`),
    actionsTrack,
  ].filter(Boolean).join(' ');

  // ── Header row ──────────────────────────────────────────────────
  const header = (
    <Box
      role="row"
      style={{ gridTemplateColumns }}
      className={cn(
        'hidden @sm/table:grid items-center gap-3 sticky top-0 z-10',
        'bg-[var(--color-surface-subtle)] border-b border-[var(--color-border)]',
        // No font size here: track floors are `ch`, resolved per row, so the
        // header row must share the body's font size or columns drift.
        'text-muted-foreground uppercase font-semibold tracking-wide',
        lk.headPad,
      )}
    >
      {selectable && (
        <Box role="columnheader" className="flex items-center">
          <Checkbox checked={allSelected} onChange={toggleAll} aria-label={t('aria.selectAllRows')} />
        </Box>
      )}
      {colDefs.map((col) => {
        const active = sortColumn === (col.field ?? col.key);
        return (
          <Box
            key={col.key}
            role="columnheader"
            aria-sort={col.sortable && sortEvent ? (active ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none') : undefined}
            className={cn('flex items-center min-w-0', alignClass[col.align ?? 'left'])}
          >
            <Box
              {...pressableProps(col.sortable && sortEvent ? () => handleSort(col) : undefined)}
              className={cn(
                'flex items-center gap-1 min-w-0 text-xs',
                col.sortable && sortEvent && 'cursor-pointer select-none hover:text-foreground',
              )}
            >
              {col.icon && renderIconInput(col.icon, { size: 'xs' })}
              <span className="truncate">{columnLabel(col)}</span>
              {col.sortable && sortEvent && (
                <Icon
                  name={active ? (sortDirection === 'asc' ? 'chevron-up' : 'chevron-down') : 'chevrons-up-down'}
                  size="xs"
                  className={cn('flex-shrink-0', active ? 'text-foreground' : 'opacity-40')}
                />
              )}
            </Box>
          </Box>
        );
      })}
      {hasActions && (
        <Box aria-hidden className="sticky right-0 bg-[var(--color-surface-subtle)] border-l border-[var(--color-border)] h-full" />
      )}
    </Box>
  );

  // ── A single body row ───────────────────────────────────────────
  const renderRow = (row: EntityRow, index: number) => {
    const id = String(row[idField] ?? index);
    const rowClickEvent = itemClickEvent || undefined;
    const onOpen = rowClickEvent ? handleRowClick(row) : undefined;
    const overflowActions = rowActions(actionDefs, row);
    const rowInner = (
      <Box
        role="row"
        data-entity-row
        data-entity-id={id}
        data-row-pending={isRowPending(id) || undefined}
        aria-busy={isRowPending(id) || undefined}
        aria-selected={selectable ? selected.has(id) : undefined}
        onClick={onOpen}
        style={!hasRenderProp ? { gridTemplateColumns } : undefined}
        className={cn(
          'group relative transition-colors duration-fast',
          hasRenderProp ? 'flex items-center gap-3' : 'flex flex-col gap-1 @sm/table:grid @sm/table:items-center @sm/table:gap-3',
          rowClickEvent && 'cursor-pointer',
          lk.rowPad,
          lk.divider && 'border-b border-[var(--color-border)]',
          lk.striped && index % 2 === 1 && 'bg-[var(--color-surface-subtle)]',
          'hover:bg-[var(--color-surface-subtle)]',
          look === 'bordered' && '@sm/table:[&>*]:border-r @sm/table:[&>*]:border-[var(--color-border)] @sm/table:[&>*:last-child]:border-r-0',
        )}
      >
        {selectable && (
          <Box role="cell" className={cn('flex items-center', STRETCHED_ABOVE)} onClick={rowClickEvent ? (e) => e.stopPropagation() : undefined}>
            <Checkbox
              checked={selected.has(id)}
              onChange={() => toggleRow(id)}
              aria-label={t('table.selectRow', { id })}
            />
          </Box>
        )}
        {hasRenderProp ? (
          <Box role="cell" className="relative flex-1 min-w-0">
            {onOpen && (
              <Box
                {...rowOpenControlProps(true)}
                aria-label={t('aria.openRow', { position: index + 1 })}
                className="absolute inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
              />
            )}
            <Box className={cn(onOpen && 'relative')}>
              {children(row, index)}
            </Box>
          </Box>
        ) : (
          colDefs.map((col) => {
            const raw = asFieldValue(getNestedValue(row, col.field ?? col.key));
            // The open control lives in the title column (else the first): its
            // ::after stretches over the row, so actions stay sibling cells.
            const opens = onOpen !== undefined && col.key === openColKey;
            const asControl = (node: React.ReactNode): React.ReactNode => opens
              ? <Box {...rowOpenControlProps(true)} className={cn('min-w-0', STRETCHED_CONTROL)}>{node}</Box>
              : node;
            // Narrow: the declared title column heads the card; every other
            // cell is a label ⟷ value line (the header row is hidden there).
            const isTitle = col.variant === 'h3' || col.variant === 'h4';
            const cellBase = cn(
              'flex items-center min-w-0 gap-3',
              isTitle ? 'font-medium @sm/table:font-[inherit]' : 'justify-between',
              isTitle && hasActions && 'pr-10 @sm/table:pr-0',
              alignClass[col.align ?? 'left'],
              weightClass[col.weight ?? 'normal'],
              col.className,
            );
            const stackedLabel = isTitle ? null : (
              <span className="@sm/table:hidden shrink-0 text-xs text-muted-foreground" data-stacked-label>
                {columnLabel(col)}
              </span>
            );
            if (col.format === 'badge' && raw != null && raw !== '') {
              const relationDisplay = resolveRelationCellDisplay(raw, relationsData?.[col.field ?? col.key]);
              const label = relationDisplay ?? col.labels?.[String(raw)]
                ?? (typeof raw === 'boolean' ? formatValue(raw, 'boolean', fmt) : valueLabelFor(String(raw), col.labels));
              return (
                <Box key={col.key} role="cell" className={cellBase}>
                  {stackedLabel}
                  {asControl(<Badge variant={badgeVariantFor(String(raw), col.colorMap)} size="sm" className="whitespace-nowrap">{label}</Badge>)}
                </Box>
              );
            }
            return (
              <Box key={col.key} role="cell" className={cellBase}>
                {stackedLabel}
                {asControl(<span className="truncate text-foreground">{formatCell(raw, col.format, relationsData?.[col.field ?? col.key], fmt)}</span>)}
              </Box>
            );
          })
        )}
        {hasActions && (
          <HStack
            role="cell"
            gap="xs"
            // The Menu's item onClick has no stopPropagation of its own, so
            // the whole actions cell shields the row click instead.
            onClick={rowClickEvent ? (e) => e.stopPropagation() : undefined}
            className={cn(
              // Wide: pinned — the fixed column tracks routinely overflow the
              // caller's scroll container, which would leave the kebab
              // off-screen. Opaque + hairline edge so it reads as a pinned
              // column while scrolled cells pass underneath. Narrow: the
              // stacked card's top-right corner.
              'justify-end flex-shrink-0 z-[1] transition-colors',
              'absolute top-1 right-1 @sm/table:sticky @sm/table:top-auto @sm/table:right-0',
              '@sm/table:border-l @sm/table:border-[var(--color-border)]',
              lk.striped && index % 2 === 1
                ? 'bg-[var(--color-surface-subtle)]'
                : 'bg-[var(--color-card)] group-hover:bg-[var(--color-surface-subtle)]',
            )}
          >
            {overflowActions.length > 0 && (
              <Menu
                position="bottom-end"
                trigger={
                  <Button variant="ghost" size="sm" aria-label={t('common.actions')} data-testid={ACTION_OVERFLOW_TESTID} data-row-id={String(row.id)}>
                    <Icon name="more-horizontal" size="xs" />
                  </Button>
                }
                items={overflowActions.map((action) => ({
                  label: action.label,
                  icon: action.icon,
                  event: action.event,
                  variant: action.variant === 'danger' ? 'danger' : 'default',
                  onClick: () => fireRowAction(action, row, id),
                }))}
              />
            )}
          </HStack>
        )}
      </Box>
    );
    return dnd.isZone ? (
      <dnd.SortableItem key={id} id={row[idField] as string | number ?? id}>{rowInner}</dnd.SortableItem>
    ) : (
      <React.Fragment key={id}>{rowInner}</React.Fragment>
    );
  };

  const items = Array.from(data);
  const groups = groupBy ? groupRows(items, groupBy) : [{ label: '', items }];

  let runningIndex = 0;
  const body = (
    <Box role="rowgroup">
      {groups.map((group, gi) => (
        <React.Fragment key={gi}>
          {group.label && <Divider label={group.label} className={gi > 0 ? 'mt-3' : 'mt-0'} />}
          {group.items.map((row) => renderRow(row, runningIndex++))}
        </React.Fragment>
      ))}
    </Box>
  );

  // A header with no columns and no render prop is an empty bar — noise, not
  // chrome. Every other case keeps it mounted so the status row replaces the
  // BODY only, and one `wrapContainer` keeps an empty list a valid drop target.
  const showHeader = colDefs.length > 0 || hasRenderProp;

  return contentSurface.provide(
    <Box
      role="table"
      {...domPassthrough(rest)}
      className={cn('@container/table w-full text-sm', contentSurface.className && cn(contentSurface.className, 'overflow-hidden'), className)}
    >
      {showHeader && header}
      {dnd.wrapContainer(statusNode ? (
        <Box role="rowgroup">
          <Box role="row"><Box role="cell" className="w-full">{statusNode}</Box></Box>
        </Box>
      ) : body)}
      {!statusNode && hasMore && (
        <Box className="flex justify-center py-3">
          <Button variant="ghost" size="sm" onClick={() => setVisibleCount((p) => p + (pageSize || 5))}>
            <Icon name="chevron-down" size="xs" className="mr-1" />
            {t('common.showMore')} ({t('common.remaining', { count: ordered.length - visibleCount })})
          </Button>
        </Box>
      )}
    </Box>
  );
}

TableView.displayName = 'TableView';
