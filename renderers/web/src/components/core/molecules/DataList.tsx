'use client';
/**
 * DataList Molecule
 *
 * A simplified, schema-driven list for iterating over entity data.
 * Extracted from the List organism with all complexity removed:
 * no built-in search, filter, selection, bulk actions, or custom renderers.
 * Ordering is available via `sortBy`/`sortDirection`, but it orders only the
 * rows handed in — a set larger than its `limit` must be ordered upstream.
 *
 * Accepts `fields` config for per-field rendering control (icon, variant, format)
 * and `itemActions` for per-item event bus wiring.
 *
 * Uses atoms only internally: Box, VStack, HStack, Typography, Badge, Button, Icon.
 */
import { actionTestId, ACTION_OVERFLOW_TESTID } from '@almadar/core';
import React from 'react';
import type { A11yProps, SkeletonSpec, EntityRow, EventKey, EventEmit, FieldValue } from "@almadar/core";
import { Skeleton } from "./Skeleton";
import type { ItemActionPayload } from '@almadar/core/patterns';
import { cn } from '../../../core';
import { useContentSurface } from '../../../core';
import type { SurfaceMode } from '@almadar/core';
import { entityRows } from '../../../lib/entityRows';
import { rowOpenControlProps, STRETCHED_CONTROL, STRETCHED_ABOVE } from '../../../core';
import { domPassthrough } from '../../../core';
import { formatDate, formatValue as libFormatValue, type FormatContext, sortRows } from '../../../core';
import { resolveRelationCellDisplay } from '../../../lib/relationLabel';
import type { RelationOption } from './RelationSelect';
import { createLogger } from '@almadar/logger';

const dataListLog = createLogger('almadar:ui:data-list');
import { getNestedValue } from '../../../lib/getNestedValue';
import { groupRows } from '../../../lib/groupRows';
import { useEventBus, useNavStack } from '../../../core';
import { enterClassName } from '../../../lib/enter';
import { useItemMoves } from '../../../lib/item-move';
import { useRowActions, useRowActionPayload, useRowActionFire } from '../../../hooks/useRowActions';
import type { RowActionCondition, RowActionPayload } from '../../../lib/row-action-when';
import { useTranslate, useFormatContext } from '../../../core';
import { Box } from '../../../core';
import { VStack, HStack } from '../../../core';
import { Typography } from '../../../core';
import { EmptyState, type EmptyStateSlotProps } from './EmptyState';
import { Badge } from '../../../core';
import { Avatar } from '../../../core';
import { Button } from '../../../core';
import { Icon } from '../../../core';
import type { IconInput } from '../../../core';
import { ProgressBar } from '../../../core';
import { Divider } from '../../../core';
import { InfiniteScrollSentinel } from '../../../core';
import { Menu } from './Menu';
import { useDataDnd, type DataDndProps } from './useDataDnd';
import type { DisplayField, DisplayFieldFormat, UiError } from '../../../core';
import { badgeVariantFor, titleFieldOf, valueLabelFor } from '../../../lib/displayField';

// ── Field Definition ─────────────────────────────────────────────────

/** A DataList field is the shared display-field shape: every slot (title, badge, format, colour) is declared on it. */
export type DataListField = DisplayField;

// ── Item Action Definition ───────────────────────────────────────────

export interface DataListItemAction {
  /** Button label */
  label: string;
  /** Event name to emit (dispatched as UI:{event} with { id, row: itemData }) */
  event: EventKey;
  /** Lucide icon name or component */
  icon?: IconInput;
  /** Button variant */
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  /** Per-row condition, authored as `(fn row <bool>)`: the row's button is drawn only when it returns true. Omit = always shown. */
  when?: RowActionCondition;
  /** Extra data the action sends, authored as `(fn row { key: <expr> })`; it emits `{ id, row }` plus these keys. */
  payload?: RowActionPayload;
  /** Page the action opens instead of emitting; `{{row.<field>}}` is replaced with the row's value. */
  navigatesTo?: string;
}

export interface DataListSwipeAction {
  /** Button label */
  label: string;
  /** Lucide icon name or component */
  icon?: IconInput;
  /** Button variant */
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
}

// ── Props ────────────────────────────────────────────────────────────

/**
 * @fieldsContract display
 * @minWidth 200
 */
export interface DataListProps extends DataDndProps, EmptyStateSlotProps, A11yProps {
  /**
   * Schema entity data — the collection of rows to render.
   */
  entity: readonly EntityRow[];
  /**
   * Field definitions for rendering each row. The pattern contract in
   * `@almadar/core/patterns` documents `columns` as the wire-format alias the
   * compiler emits — both names resolve to the same shape here. Pass either.
   */
  fields?: readonly DataListField[];
  /** Alias for `fields` — the compiler emits `columns` for field defs. */
  columns?: readonly DataListField[];
  /** Per-item action buttons */
  itemActions?: readonly DataListItemAction[];
  /** Entrance animation each row plays when it mounts, so an item arriving in this list (moved from another) animates in */
  itemEnter?: 'none' | 'fade' | 'rise' | 'scale' | 'slide';
  /** Max inline action buttons before the rest collapse into a "⋯" overflow menu. Omit = all inline. */
  maxInlineActions?: number;
  /** When set, the whole row is clickable and emits UI:{itemClickEvent} with
   *  { id, row } (action-button clicks stopPropagation so they still win). */
  /** @entityRow row */
  itemClickEvent?: EventEmit<ItemActionPayload>;
  /** Gap between rows */
  gap?: 'none' | 'sm' | 'md' | 'lg';
  /** Visual variant */
  variant?: 'default' | 'card' | 'compact' | 'message';
  /** Group items by a field value (renders section headers between groups) */
  groupBy?: string;
  /** How a `groupBy` value is bucketed and labelled (`date` = one section per day) */
  groupFormat?: DisplayFieldFormat;
  /** Field name identifying the sender (used with variant: "message") */
  senderField?: string;
  /**
   * Field holding the sender's human-readable name (used with variant: "message").
   * Defaults to `senderField`. Set this when `senderField` holds an id — an
   * id-keyed thread otherwise labels bubbles `staff-1` instead of `Sam Staff`.
   */
  senderLabelField?: string;
  /** Current user identifier; messages matching this value align right (used with variant: "message") */
  currentUser?: string;
  /**
   * Message shown when there are no rows. Falls back to the generic
   * "no items" translation. `TableView` already exposes this; an agenda or an
   * inbox wants to say what "empty" means in its own words.
   */
  emptyMessage?: string;
  /** Additional CSS classes */
  className?: string;
  /** Loading state */
  isLoading?: boolean;
  /** Skeleton drawn while loading, and the shape an empty slot shows while this element's server render is in flight (`none` opts out). */
  skeleton?: SkeletonSpec;
  /** Error state */
  error?: UiError | null;
  /** Enable drag-to-reorder with grip handles */
  reorderable?: boolean;
  /** Event emitted on reorder: UI:{reorderEvent} with { fromIndex, toIndex } */
  reorderEvent?: EventKey;
  /** Event emitted on left swipe: UI:{swipeLeftEvent} with { row } */
  swipeLeftEvent?: EventKey;
  /** Actions revealed on left swipe */
  swipeLeftActions?: readonly DataListSwipeAction[];
  /** Event emitted on right swipe: UI:{swipeRightEvent} with { row } */
  swipeRightEvent?: EventKey;
  /** Actions revealed on right swipe */
  swipeRightActions?: readonly DataListSwipeAction[];
  /** Event emitted on long press: UI:{longPressEvent} with { row } */
  longPressEvent?: EventKey;
  /** Enable infinite scroll loading */
  infiniteScroll?: boolean;
  /** Event emitted when more items needed: UI:{loadMoreEvent} */
  loadMoreEvent?: EventKey;
  /** Whether more items are available for infinite scroll */
  hasMore?: boolean;
  /** Render prop for custom per-item content. When provided, `fields` and `itemActions` are ignored. */
  /**
   * Render function for each row's content. Receives a row and the row's
   * index in the materialised array.
   */
  children?: (item: EntityRow, index: number) => React.ReactNode;
  /**
   * Per-item render function (schema-level alias for children render prop).
   * In .orb schemas: ["fn", "item", { pattern tree with @item.field bindings }]
   * The compiler converts this to the children render prop.
   * In .lolo, author the per-item renderer as renderItem: (fn item <Component …={@item.field}/>), binding per-item fields via @item.field.
   * @deprecated Use children render prop in React code. This prop exists for pattern registry sync.
   */
  renderItem?: (item: EntityRow, index: number) => React.ReactNode;
  /** Max items to show before "Show More" button. Defaults to 5. Set to 0 to disable. */
  pageSize?: number;
  /**
   * Field name to order rows by. Values are compared by their own type —
   * numbers numerically, date-like strings chronologically, everything else
   * alphabetically — never by what the field is called. Empty cells sort last.
   * Unset leaves the incoming order untouched.
   *
   * Orders only the rows already fetched: a collection larger than its `limit`
   * still needs ordering at the data layer.
   */
  sortBy?: string;
  /** Direction for `sortBy`. Defaults to ascending. */
  sortDirection?: "asc" | "desc";
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

// Thin wrapper over the shared formatter that keeps DataList's i18n yes/no
// labels for boolean fields and resolves relation fields to their label
// (hydrated row, or a bare foreign id via the field's `relationsData` options).
function formatValue(
  value: FieldValue | undefined,
  format: DataListField['format'] | undefined,
  fmt: FormatContext,
  relationOptions?: readonly RelationOption[],
): string {
  const relationDisplay = resolveRelationCellDisplay(value, relationOptions);
  if (relationDisplay !== undefined) return relationDisplay;
  return libFormatValue(value, format, fmt);
}

// ── Component ────────────────────────────────────────────────────────

// Layer 2 look styles for DataList — applied to the list root and
// child row containers via `[&_[data-entity-row]>div]:` selectors
// (each row's inner Box carries the row's classes; targeting the
// outer wrapper would miss the rendered chrome).
const listLookStyles: Record<NonNullable<DataListProps['look']>, string> = {
  dense: '[&_[data-entity-row]>div]:!py-1 [&_[data-entity-row]>div]:!px-3',
  spacious: '[&_[data-entity-row]>div]:!py-5 [&_[data-entity-row]>div]:!px-8',
  striped: '[&_[data-entity-row]:nth-child(even)>div]:bg-muted/30',
  borderless: '[&_[data-entity-row]>div]:!border-0 [&_[data-entity-row]>div]:!hover:border-transparent',
  'card-rows': '[&_[data-entity-row]>div]:surface-content [&_[data-entity-row]]:mb-2',
};

export function DataList({
  entity,
  fields,
  columns,
  itemActions,
  itemEnter,
  maxInlineActions,
  itemClickEvent,
  gap = 'none',
  variant = 'default',
  groupBy,
  groupFormat,
  senderField,
  senderLabelField,
  currentUser,
  emptyMessage,
  emptyIcon,
  emptyTitle,
  emptyDescription,
  emptyAction,
  className,
  isLoading = false,
  skeleton = 'list',
  error = null,
  // Gesture props: reorderable, swipeLeftEvent, swipeRightEvent, longPressEvent
  // are consumed by the compiler to wrap items in SwipeableRow/SortableList.
  // DataList destructures them here to prevent DOM passthrough.
  reorderable: _reorderable,
  reorderEvent: _reorderEvent,
  swipeLeftEvent: _swipeLeftEvent,
  swipeLeftActions: _swipeLeftActions,
  swipeRightEvent: _swipeRightEvent,
  swipeRightActions: _swipeRightActions,
  longPressEvent: _longPressEvent,
  infiniteScroll,
  loadMoreEvent,
  hasMore,
  children,
  pageSize = 5,
  sortBy,
  sortDirection,
  renderItem: schemaRenderItem,
  dragGroup,
  accepts,
  sortable: sortableProp,
  dropEvent,
  reorderEvent: dndReorderEvent,
  positionEvent,
  dndItemIdField,
  dndRoot,
  look = 'dense',
  surface = 'auto',
  relationsData,
  ...rest
}: DataListProps) {
  const eventBus = useEventBus();
  const navStack = useNavStack();
  const moves = useItemMoves(itemEnter !== undefined && itemEnter !== 'none');
  const rowActions = useRowActions();
  const actionPayload = useRowActionPayload();
  const { fire: fireRowAction, isRowPending } = useRowActionFire<DataListItemAction>();
  const { t } = useTranslate();
  const fmt = useFormatContext();
  // card-rows makes every row its own surface, so the list itself stays flat.
  const contentSurface = useContentSurface(look === 'card-rows' ? 'none' : surface);
  const [visibleCount, setVisibleCount] = React.useState(pageSize || Infinity);

  // Honor the pattern-types alias: compiler emits `columns`, the React API
  // accepts `fields`. Either resolves to the same shape; missing both yields
  // an empty list rather than a TypeError on `.find`.
  const fieldDefs: readonly DataListField[] = fields ?? columns ?? [];

  const allDataRaw = entityRows(entity);
  const dnd = useDataDnd({
    items: allDataRaw as readonly EntityRow[],
    layout: 'list',
    dragGroup,
    accepts,
    sortable: sortableProp,
    dropEvent,
    reorderEvent: dndReorderEvent,
    positionEvent,
    dndItemIdField,
    dndRoot,
  });
  // Sort before paginating — slicing an unordered set makes "first N" arbitrary.
  // A drag-reordered list is a different mode, so `sortBy` wins only when set.
  const orderedData = dnd.orderedItems as readonly EntityRow[];
  const allData = React.useMemo(
    () => sortRows(orderedData, sortBy, sortDirection),
    [orderedData, sortBy, sortDirection],
  );
  const data = pageSize > 0 ? allData.slice(0, visibleCount) : allData;
  const hasMoreLocal = pageSize > 0 && visibleCount < allData.length;
  // The compiled (orbital-rust) codegen path passes the per-item renderer
  // as the `renderItem` PROP (a real function); the interpreted/runtime
  // path passes it as `children` (a function-as-children render-prop).
  // Both are the same contract — accept either (C-DATALIST-RENDERITEM-
  // IGNORED: `renderItem` was declared + typed but never invoked, so every
  // compiled DataList silently fell back to the fields-based path with the
  // data-loss warning below firing on every render).
  const renderItemFn = typeof schemaRenderItem === 'function' ? schemaRenderItem : undefined;
  const itemRenderer = typeof children === 'function' ? children : renderItemFn;
  const hasRenderProp = typeof itemRenderer === 'function';

  // Diagnostic: when we have data + a `renderItem` prop but it's not a
  // function (e.g. it arrived as an unconverted `["fn","item",{...}]`
  // sExpression lambda from the schema), DataList silently falls back
  // to the fields-based path. Hook MUST stay above early returns —
  // entity arriving empty-then-populated otherwise tripped Rules-of-Hooks.
  React.useEffect(() => {
    const renderItemTypeOf = typeof schemaRenderItem;
    const childrenTypeOf = typeof children;
    if (data.length > 0 && !hasRenderProp) {
      const firstRow: EntityRow | undefined = data[0];
      const sampleKeys = firstRow ? Object.keys(firstRow).slice(0, 6) : [];
      const isFnLambda =
        Array.isArray(schemaRenderItem) &&
        (schemaRenderItem as FieldValue[]).length >= 3 &&
        ((schemaRenderItem as FieldValue[])[0] === 'fn' || (schemaRenderItem as FieldValue[])[0] === 'lambda');
      dataListLog.warn('renderItem-unresolved', {
        rowCount: data.length,
        fieldsCount: fieldDefs.length,
        renderItemTypeOf,
        renderItemIsArray: Array.isArray(schemaRenderItem),
        renderItemIsFnLambda: isFnLambda,
        renderItemHead: Array.isArray(schemaRenderItem) ? String((schemaRenderItem as FieldValue[])[0]) : undefined,
        childrenTypeOf,
        sampleRowKeys: sampleKeys,
      });
    }
  }, [data, hasRenderProp, schemaRenderItem, children, fieldDefs]);

  // Separate fields by role
  const titleField = titleFieldOf(fieldDefs);
  const avatarField = fieldDefs.find((f) => f.variant === 'avatar');
  const overlineFields = fieldDefs.filter((f) => f.variant === 'overline');
  const badgeFields = fieldDefs.filter((f) => f.variant === 'badge' && f !== titleField);
  const progressFields = fieldDefs.filter((f) => f.variant === 'progress');
  const proseFields = fieldDefs.filter((f) => f.variant === 'caption' && f.format !== 'boolean');
  const bodyFields = fieldDefs.filter(
    (f) => f !== titleField && f.variant !== 'avatar' && !overlineFields.includes(f) && !badgeFields.includes(f)
      && !progressFields.includes(f) && !proseFields.includes(f)
  );

  // navigatesTo-first with early return, as DataGrid does: a navigating action never also emits.
  const fireAction = (action: DataListItemAction, itemData: EntityRow) => {
    if (action.navigatesTo) {
      const url = action.navigatesTo.replace(/\{\{row\.(\w+(?:\.\w+)*)\}\}/g, (_, field: string) =>
        String(itemData[field] ?? ''),
      );
      navStack.goTo(url);
      return;
    }
    fireRowAction(action, itemData, String(itemData.id ?? ""));
  };

  const handleActionClick = (action: DataListItemAction, itemData: EntityRow) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fireAction(action, itemData);
  };

  // Inline up to `maxInlineActions` row actions; collapse the rest into a "⋯" overflow menu.
  /**
   * `onPrimary` recolours the actions for a filled surface — a sent message
   * bubble paints `bg-primary`, where a default-foreground ghost button is
   * dark-on-purple and effectively invisible.
   */
  const renderItemActions = (itemData: EntityRow, onPrimary = false, only?: readonly DataListItemAction[]) => {
    if (!itemActions || itemActions.length === 0) return null;
    const shown = only ?? rowActions(itemActions, itemData);
    if (shown.length === 0) return null;
    const inline = maxInlineActions != null ? shown.slice(0, maxInlineActions) : shown;
    const overflow = maxInlineActions != null ? shown.slice(maxInlineActions) : [];
    return (
      // stopPropagation at the cluster: the "⋯" trigger opens the overflow
      // menu without also firing the row's default click (inline buttons
      // already stop it in handleActionClick; the Menu panel is portaled).
      <HStack gap="xs" onClick={itemClickEvent ? (e) => e.stopPropagation() : undefined} className={cn('flex-shrink-0', STRETCHED_ABOVE)}>
        {inline.map((action, idx) => (
          <Button
            key={idx}
            variant={action.variant ?? 'ghost'}
            size="sm"
            onClick={handleActionClick(action, itemData)}
            data-testid={actionTestId(action.event)}
            data-row-id={String(itemData.id)}
            className={cn(
              action.variant === 'danger' && 'text-foreground hover:bg-error/10',
              // Must sit on the Button itself: the variant's own text colour
              // beats an inherited one from the row wrapper.
              onPrimary && '!text-primary-foreground hover:bg-primary-foreground/15',
            )}
          >
            {action.icon && renderIconInput(action.icon, { size: 'xs', className: 'mr-1' })}
            {action.label}
          </Button>
        ))}
        {overflow.length > 0 && (
          <Menu
            position="bottom-end"
            trigger={
              <Button variant="ghost" size="sm" aria-label={t('common.actions')} data-testid={ACTION_OVERFLOW_TESTID}>
                <Icon name="more-horizontal" size="xs" />
              </Button>
            }
            items={overflow.map((action) => ({
              label: action.label,
              icon: action.icon,
              variant: action.variant === 'danger' ? 'danger' : 'default',
              onClick: () => fireAction(action, itemData),
            }))}
          />
        )}
      </HStack>
    );
  };

  const handleRowClick = (itemData: EntityRow) => () => {
    if (!itemClickEvent) return;
    const payload: ItemActionPayload = {
      id: itemData.id as string | number,
      row: itemData as ItemActionPayload['row'],
    };
    eventBus.emit(`UI:${itemClickEvent}`, payload);
  };

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

  // Empty state — when DnD is enabled, render the empty state INSIDE the
  // wrapContainer so DropZoneShell mounts and the column can still accept
  // drops. Returning the bare message early would un-mount the droppable
  // (kanban column with zero cards becomes a dead zone).
  if (data.length === 0) {
    const emptyNode = (
      <EmptyState
        icon={emptyIcon}
        title={emptyTitle || emptyMessage || t('empty.noItems')}
        description={emptyDescription}
        actionLabel={emptyAction?.label}
        actionEvent={emptyAction?.event}
      />
    );
    return dnd.enabled ? <>{dnd.wrapContainer(emptyNode)}</> : emptyNode;
  }

  const gapClass = {
    none: '',
    sm: 'gap-1',
    md: 'gap-2',
    lg: 'gap-4',
  }[gap];

  const isCard = variant === 'card';
  const isCompact = variant === 'compact';
  const isMessage = variant === 'message';

  // ── Message variant ──────────────────────────────────────────────
  if (isMessage) {
    const items = [...data];
    const groups = groupBy ? groupRows(items, groupBy, groupFormat, fmt) : [{ label: '', items }];
    const contentField = (fieldDefs.find((f) => f.variant === 'body') ?? titleField)?.name ?? '';
    // The bubble label. Falls back to the raw sender cell so existing callers
    // are unchanged; with `senderLabelField` an id-keyed thread shows the name.
    const senderLabel = (itemData: EntityRow, raw: string): string => {
      if (!senderLabelField) return raw;
      const v = getNestedValue(itemData, senderLabelField);
      return v === undefined || v === null || v === '' ? raw : String(v);
    };

    return (
      <VStack gap="sm" className={cn('py-2', className)} data-item-move-root={moves.root}>
        {groups.map((group, gi) => (
          <React.Fragment key={gi}>
            {group.label && (
              <Divider label={group.label} className="my-2" />
            )}
            {group.items.map((itemData, index) => {
              const id = (itemData.id as string) || `${gi}-${index}`;
              const sender = senderField ? String(getNestedValue(itemData, senderField) ?? '') : '';
              const isSent = Boolean(currentUser && sender === currentUser);
              const content = getNestedValue(itemData, contentField);
              const timestampField = fieldDefs.find((f) => f.format === 'date');
              const timestamp = (timestampField ? getNestedValue(itemData, timestampField.name) : null) as FieldValue | null;
              // Every declared field other than the bubble's own content and its
              // timestamp — chat's `channel` badge used to be dropped silently.
              const metaFields = fieldDefs.filter(
                (f) => f.name !== contentField && f.name !== timestampField?.name,
              );

              return (
                <Box
                  key={id}
                  data-entity-row
                  data-entity-id={id}
                  data-item-key={id}
                  data-item-move={moves.row}
 data-row-pending={isRowPending(String(itemData.id ?? "")) || undefined}
 aria-busy={isRowPending(String(itemData.id ?? "")) || undefined}
                  onClick={itemClickEvent ? handleRowClick(itemData) : undefined}
                  className={cn(
                    enterClassName(itemEnter),
                    'relative flex px-4 group/rowactions',
                    itemClickEvent && 'cursor-pointer',
                    isSent ? 'justify-end' : 'justify-start',
                  )}
                >
                  <Box
                    className={cn(
                      'max-w-[75%] px-4 py-2',
                      isSent
                        ? 'bg-primary text-primary-foreground rounded-container rounded-ee-sm'
                        : 'bg-muted text-foreground rounded-container rounded-es-sm',
                    )}
                  >
                    {!isSent && senderField && (
                      <Typography variant="caption" className="font-semibold mb-0.5">
                        {senderLabel(itemData, sender)}
                      </Typography>
                    )}
                    <Box {...rowOpenControlProps(itemClickEvent !== undefined)} className={cn(itemClickEvent && STRETCHED_CONTROL)}>
                      <Typography variant="body" className={cn(isSent && 'text-primary-foreground')}>
                        {content !== undefined && content !== null ? String(content) : ''}
                      </Typography>
                    </Box>
                    {metaFields.length > 0 && (
                      <HStack gap="xs" className="mt-1 flex-wrap">
                        {metaFields.map((f) => {
                          const v = getNestedValue(itemData, f.name);
                          if (v === undefined || v === null || v === '') return null;
                          return f.variant === 'badge' ? (
                            // `format` applies here too — a boolean field badged
                            // without it renders the raw "false" instead of "No".
                            <Badge key={f.name} variant={badgeVariantFor(String(v), f.colorMap)}>
                              {valueLabelFor(formatValue(v as FieldValue, f.format, fmt, relationsData?.[f.name]), f.labels)}
                            </Badge>
                          ) : (
                            <Typography
                              key={f.name}
                              variant="caption"
                              className={cn('text-xs', isSent ? 'opacity-70' : 'text-muted-foreground')}
                            >
                              {formatValue(v as FieldValue, f.format, fmt, relationsData?.[f.name])}
                            </Typography>
                          );
                        })}
                      </HStack>
                    )}
                    <HStack gap="xs" className="mt-1 items-center justify-between flex-wrap">
                      {timestamp != null ? (
                        <Typography
                          variant="caption"
                          className={cn('text-xs whitespace-nowrap', isSent ? 'opacity-70' : 'text-muted-foreground')}
                        >
                          {formatDate(timestamp)}
                        </Typography>
                      ) : <span />}
                      {renderItemActions(itemData, isSent)}
                    </HStack>
                  </Box>
                </Box>
              );
            })}
          </React.Fragment>
        ))}
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
      </VStack>
    );
  }

  // ── Grouped rendering (non-message variants) ─────────────────────
  const items = [...data];
  const groups = groupBy ? groupRows(items, groupBy, groupFormat, fmt) : [{ label: '', items }];

  const idFieldName = dndItemIdField ?? 'id';
  const renderItem = (itemData: EntityRow, index: number, isLast: boolean) => {
    const dndId = (itemData[idFieldName] as string | number | undefined) ?? `__idx_${index}`;
    const wrapDnd = (node: React.ReactNode): React.ReactNode =>
      dnd.isZone ? <dnd.SortableItem key={dndId} id={dndId}>{node}</dnd.SortableItem> : node;
    const rowId = String(itemData.id ?? '');
    const pending = isRowPending(rowId) || undefined;
    const onOpen = itemClickEvent ? handleRowClick(itemData) : undefined;
    const divider = (isCard || isCompact) && !isLast
      ? <Box className={cn('border-b border-border/40', isCompact ? 'mx-4' : 'mx-6')} />
      : null;

    // Custom render-prop path: the custom card owns its chrome. Row opening is a
    // named overlay control beneath the content; the content lets clicks through
    // except on its own interactive elements, and actions sit above both.
    if (hasRenderProp) {
      const id = (itemData.id as string) || String(index);
      const allActions = itemActions ? rowActions(itemActions, itemData) : [];
      // The row's call to action stays visible on every pointer; the rest are hover/kebab.
      const primaryActions = allActions.filter((a) => a.variant === 'primary');
      const otherActions = allActions.filter((a) => a.variant !== 'primary');
      const primary = primaryActions.length > 0 ? renderItemActions(itemData, false, primaryActions) : null;
      const actions = otherActions.length > 0 ? renderItemActions(itemData, false, otherActions) : null;
      return wrapDnd(
        <Box key={id} data-entity-row data-entity-id={id} data-item-key={id} data-item-move={moves.row} data-row-pending={pending} aria-busy={pending}
          onClick={onOpen} className={cn('relative group/rowactions', onOpen && 'cursor-pointer', enterClassName(itemEnter))}>
          {onOpen && (
            <Box
              {...rowOpenControlProps(true)}
              aria-label={t('aria.openRow', { position: index + 1 })}
              className="absolute inset-0 rounded-[inherit] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
            />
          )}
          <Box className={cn(onOpen && 'relative')}>
            {itemRenderer!(itemData as EntityRow, index)}
          </Box>
          {primary && (
            <HStack justify="end" className={cn('relative px-4 pb-3', STRETCHED_ABOVE)}>
              {primary}
            </HStack>
          )}
          {actions && (
            <Box onClick={(e) => e.stopPropagation()} className="absolute top-2 right-2 z-10 opacity-0 group-hover/rowactions:opacity-100 focus-within:opacity-100 [@media(pointer:coarse)]:opacity-100 transition-opacity duration-fast">
              {/* Fine pointers: hover-revealed inline cluster. */}
              <Box className="rounded-container border border-border bg-card/95 backdrop-blur-sm shadow-elevation-popover surface-material p-0.5 [@media(pointer:coarse)]:hidden">
                {actions}
              </Box>
              {/* Coarse pointers: always-visible single kebab — an inline
                  cluster would sit on the card title at phone widths
                  (verified at 390px). */}
              <Box className="hidden [@media(pointer:coarse)]:block rounded-container border border-border bg-card/95 backdrop-blur-sm shadow-elevation-popover surface-material p-0.5">
                <Menu
                  position="bottom-end"
                  trigger={
                    <Button variant="ghost" size="sm" aria-label={t('common.actions')} data-testid={ACTION_OVERFLOW_TESTID}>
                      <Icon name="more-horizontal" size="xs" />
                    </Button>
                  }
                  items={otherActions.map((action) => ({
                    label: action.label,
                    icon: action.icon,
                    variant: action.variant === 'danger' ? ('danger' as const) : ('default' as const),
                    onClick: () => fireAction(action, itemData),
                  }))}
                />
              </Box>
            </Box>
          )}
          {isCard && divider}
        </Box>
      );
    }

    // Default fields-based path. Each field's declared role places it:
    // avatar leads, overline sits above the title, caption is prose under it,
    // everything else is the meta line (row position labels it, as in Gmail).
    const id = (itemData.id as string) || String(index);
    const titleValue = getNestedValue(itemData, titleField?.name ?? '');
    const titleDisplay = resolveRelationCellDisplay(
      titleValue as FieldValue | undefined,
      titleField ? relationsData?.[titleField.name] : undefined,
    ) ?? (titleValue !== undefined && titleValue !== null ? String(titleValue) : undefined);
    const avatarValue = avatarField ? getNestedValue(itemData, avatarField.name) : undefined;
    const display = (field: DataListField): string | undefined => {
      const v = getNestedValue(itemData, field.name) as FieldValue | undefined;
      return v === undefined || v === null || v === '' ? undefined : formatValue(v, field.format, fmt, relationsData?.[field.name]);
    };
    // Compact rows are scanning labels: the theme's display voice (often a
    // light or decorative heading face) would make them unreadable at row size.
    const titleNode = titleDisplay !== undefined && (
      <Typography
        variant={isCompact ? 'small' : titleField?.variant === 'h3' ? 'h3' : 'h4'}
        weight="semibold"
        className={isCompact ? 'truncate' : 'line-clamp-2 break-words'}
      >
        {titleDisplay}
      </Typography>
    );

    return wrapDnd(
      <Box key={id} data-entity-row data-entity-id={id} data-item-key={id} data-item-move={moves.row} data-row-pending={pending} aria-busy={pending}
        onClick={onOpen} className={cn('relative', onOpen && 'cursor-pointer', enterClassName(itemEnter))}>
        <Box
          className={cn(
            // items-start, not items-center: a multi-line row (title + meta +
            // progress) centred its action cluster in the vertical middle, so
            // the buttons floated between the meta fields instead of anchoring
            // to the title they act on (U-DATALIST-ACTIONS-FLOAT-MID-ROW).
            'group flex items-start gap-4 transition-all duration-fast',
            isCompact ? 'px-4 py-2' : 'px-6 py-4',
            'hover:bg-muted/80',
            !isCard && !isCompact && 'rounded-container border border-transparent hover:border-border',
          )}
        >
          {avatarValue !== undefined && avatarValue !== null && avatarValue !== '' && (
            <Avatar name={String(avatarValue)} size={isCompact ? 'sm' : 'md'} className="flex-shrink-0" />
          )}
          {titleField?.icon && !isCompact && (
            <Box className="flex-shrink-0 w-10 h-10 rounded-container bg-primary/10 flex items-center justify-center">
              {renderIconInput(titleField.icon, { size: 'sm', className: 'text-primary' })}
            </Box>
          )}
          <Box className="flex-1 min-w-0">
            {overlineFields.map((field) => {
              const text = display(field);
              return text === undefined ? null : (
                <Typography key={field.name} variant="overline" className="block text-primary mb-0.5">{text}</Typography>
              );
            })}
            <HStack gap="sm" className="items-center min-w-0">
              {titleField?.icon && isCompact && renderIconInput(titleField.icon, { size: 'xs', className: 'text-primary flex-shrink-0' })}
              {titleNode && (onOpen ? (
                <Box {...rowOpenControlProps(true)} className={cn('min-w-0 flex-1', STRETCHED_CONTROL)}>{titleNode}</Box>
              ) : (
                <Box className="min-w-0 flex-1">{titleNode}</Box>
              ))}
              {badgeFields.map((field) => {
                const val = getNestedValue(itemData, field.name);
                if (val === undefined || val === null || val === '') return null;
                return (
                  <HStack key={field.name} gap="xs" className="items-center flex-shrink-0">
                    {field.icon && renderIconInput(field.icon, { size: 'xs' })}
                    <Badge variant={badgeVariantFor(String(val), field.colorMap)}>
                      {valueLabelFor(formatValue(val as FieldValue, field.format, fmt, relationsData?.[field.name]), field.labels)}
                    </Badge>
                  </HStack>
                );
              })}
            </HStack>

            {proseFields.map((field) => {
              const text = display(field);
              return text === undefined ? null : (
                <Box key={field.name} className={isCompact ? 'mt-0.5' : 'mt-1'}>
                  <Typography variant={isCompact ? 'small' : 'body'} color="secondary" className={cn('whitespace-pre-wrap break-words', isCompact && 'line-clamp-1')}>
                    {text}
                  </Typography>
                </Box>
              );
            })}

            {/* Meta line. Compact rows keep it — an inbox row's meta (assignee,
                age) is its scanning substance (U-DATALIST-COMPACT-DROPS-META-FIELDS). */}
            {bodyFields.length > 0 && (
              <HStack gap="md" className={cn('flex-wrap', isCompact ? 'mt-0.5' : 'mt-1.5')}>
                {bodyFields.map((field) => {
                  const value = getNestedValue(itemData, field.name) as FieldValue | undefined;
                  if (value === undefined || value === null || value === '') return null;

                  return (
                    <HStack key={field.name} gap="xs" className="items-center">
                      {field.icon && renderIconInput(field.icon, { size: 'xs', className: 'text-muted-foreground' })}
                      {/* Row position is the label (Almadar_UI_Beauty.md 4: two
                          sizes max per card); the label stays for screen
                          readers. A boolean keeps its visible label — a bare
                          "Yes" names nothing. */}
                      <Typography
                        variant="caption"
                        color="secondary"
                        className={cn(field.format !== 'boolean' && 'sr-only')}
                      >
                        {field.label ?? fieldLabel(field.name)}:
                      </Typography>
                      <Typography variant="small" color="secondary">
                        {formatValue(value, field.format, fmt, relationsData?.[field.name])}
                      </Typography>
                    </HStack>
                  );
                })}
              </HStack>
            )}

            {progressFields.map((field) => {
              const value = getNestedValue(itemData, field.name);
              if (typeof value !== 'number') return null;
              return (
                <Box key={field.name} className="mt-2 max-w-xs">
                  <HStack gap="xs" className="items-center mb-1">
                    {field.icon && renderIconInput(field.icon, { size: 'xs', className: 'text-muted-foreground' })}
                    <Typography variant="caption" color="secondary">
                      {field.label ?? fieldLabel(field.name)}
                    </Typography>
                  </HStack>
                  <ProgressBar value={value} max={100} />
                </Box>
              );
            })}
          </Box>

          {renderItemActions(itemData)}
        </Box>

        {/* One separator for the scanning variants — `compact` (master-detail
            and triage) had none and records ran together
            (U-DATALIST-COMPACT-NO-ROW-SEPARATION). */}
        {divider}
      </Box>
    );
  };

  return contentSurface.provide(dnd.wrapContainer(
    <Box
      {...domPassthrough(rest)}
      data-item-move-root={moves.root}
      className={cn(
        contentSurface.className && cn(contentSurface.className, 'overflow-hidden'),
        // `gap-*` is inert on a block container, and Box only emits a display
        // class when its `display` prop is set — so every non-card list had
        // been asking for a gap that CSS silently dropped. flex-col makes it
        // real. `compact` keeps gap-0 on purpose: it separates with the row
        // divider above instead, never both (Almadar_UI_Beauty.md 6).
        !isCard && 'flex flex-col',
        !isCard && !isCompact && gapClass,
        listLookStyles[look],
        className,
      )}
    >
      {groups.map((group, gi) => (
        <React.Fragment key={gi}>
          {group.label && (
            <Divider label={group.label} className={gi > 0 ? 'mt-4' : 'mt-0'} />
          )}
          {group.items.map((itemData, index) =>
            renderItem(itemData, index, gi === groups.length - 1 && index === group.items.length - 1)
          )}
        </React.Fragment>
      ))}
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
    </Box>
  ));
};

DataList.displayName = 'DataList';
