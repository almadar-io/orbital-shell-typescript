'use client';
/**
 * useDataDnd — shared drag-drop machinery for DataList + DataGrid.
 *
 * Both primitives expose six identical drag-drop props:
 *   - dragGroup?:      string   items in this container announce this group when picked up
 *   - accepts?:        string   this container accepts drops whose dragGroup matches (or "*" for any)
 *   - sortable?:       boolean  enable in-container reorder
 *   - dropEvent?:      EventKey bus event on cross-container drop: { id, sourceGroup, targetGroup, newIndex }
 *   - reorderEvent?:   EventKey bus event on in-container reorder: { id, oldIndex, newIndex }
 *   - dndItemIdField?: string   row field used as the @dnd-kit draggable id (default "id")
 *
 * Architecture
 *   - A container that opts in via any dnd prop becomes a "zone".
 *   - The first ancestor zone in the tree creates the DndContext (the "root").
 *   - Inner zones detect the root via React context and skip creating their own.
 *   - The root's onDragEnd reads source + target zone metadata off the dragged
 *     item and the drop target, dispatches to the bus accordingly.
 */
import React from 'react';
import {
  DndContext,
  useDroppable,
  type DragCancelEvent,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { createLogger } from '@almadar/logger';

const dndLog = createLogger('almadar:ui:dnd');
import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { EntityRow, EventKey } from '@almadar/core';
import { isAriaRole } from '@almadar/core';
import { useEventBus } from '../../../core';
import { useAlmadarDndSensors, almadarDndCollisionDetection } from '../../../hooks/useAlmadarDndCollision';
import { Box } from '../../../core';

export interface DataDndProps {
  /**
   * Event emitted N times per drop (one per item in each affected zone) so
   * the trait can persist new positions for every item — not just the moved
   * one. Required for stable sort-by-position because setting only the
   * dragged item's position creates collisions with the (unchanged) others.
   * Payload: { id : string, position : number }.
   */
  positionEvent?: EventKey;
  dragGroup?: string;
  accepts?: string;
  sortable?: boolean;
  dropEvent?: EventKey;
  reorderEvent?: EventKey;
  dndItemIdField?: string;
  /**
   * Mark this container as the DnD root for its subtree. Use on an outer
   * container (e.g. a data-grid hosting inner data-lists) when the container
   * itself is NOT a drop target or sortable, but descendant zones need to
   * share one DndContext so items can be dragged between them. Inner zones
   * with `accepts` / `dragGroup` / `sortable` detect this root and skip
   * creating their own DndContext.
   */
  dndRoot?: boolean;
}

interface ZoneMeta {
  group: string;
  dropEvent?: EventKey;
  reorderEvent?: EventKey;
  /** Per-item position-update event. Emitted once per item in this zone after
   *  every drop so the trait can persist new positions for the WHOLE zone. */
  positionEvent?: EventKey;
  itemIds: UniqueIdentifier[];
  /** Raw items as provided by the consumer's `items` prop. The root reads this
   *  during cross-zone splice to find the dragged item's data when moving it
   *  out of its source zone and into the target zone's optimistic order. */
  rawItems: readonly EntityRow[];
  /** Field name to use for item id lookups (same as dndItemIdField on the consumer). */
  idField: string;
}

interface ActiveDrag {
  /** Source zone's group key — used by other zones to decide whether to show a Trello-style placeholder slot when hovering. */
  sourceGroup: string;
  /** Measured pixel height of the source item — placeholder slot uses this to reserve the right visual space. */
  height: number;
}

interface RootContext {
  registerZone: (zoneId: string, meta: ZoneMeta) => void;
  unregisterZone: (zoneId: string) => void;
  /** Currently-active drag info; null when nothing is being dragged. Exposed so DropZoneShell can show a placeholder slot for cross-zone drops. */
  activeDrag: ActiveDrag | null;
  /** Group of the zone currently being hovered, derived from over.data.dndGroup in onDragOver. Used by DropZoneShell because @dnd-kit's `isOver` returns false on the zone shell when the pointer is over an inner SortableItem (the item is its own droppable). */
  overZoneGroup: string | null;
  /** Per-zone optimistic items, keyed by group. Each zone's hook reads its
   *  own group's entry as the rendered order. Root mutates on onDragOver
   *  (same-zone arrayMove or cross-zone splice). */
  optimisticOrders: ReadonlyMap<string, readonly EntityRow[]>;
  /** Inner zones call this when their `items` prop signature changes so the
   *  optimistic order is cleared (server refetched fresh data). */
  clearOptimisticOrder: (group: string) => void;
}

const RootCtx = React.createContext<RootContext | null>(null);

interface UseDataDndArgs extends DataDndProps {
  items: readonly EntityRow[];
  layout: 'list' | 'grid';
}

interface UseDataDndResult {
  enabled: boolean;
  /** True when this container is a sortable zone (own items are draggable). False in dndRoot-only mode. */
  isZone: boolean;
  wrapContainer: (children: React.ReactNode) => React.ReactNode;
  SortableItem: React.FC<{ id: UniqueIdentifier; children: React.ReactNode }>;
  orderedItems: readonly EntityRow[];
}

export function useDataDnd(
  args: UseDataDndArgs,
): UseDataDndResult {
  const {
    dragGroup,
    accepts,
    sortable,
    dropEvent,
    reorderEvent,
    positionEvent,
    dndItemIdField = 'id',
    dndRoot,
    items,
    layout,
  } = args;

  const isZone = Boolean(dragGroup || accepts || sortable);
  const enabled = isZone || Boolean(dndRoot);
  const eventBus = useEventBus();
  const parentRoot = React.useContext(RootCtx);
  const isRoot = enabled && parentRoot === null;

  const zoneId = React.useId();
  const ownGroup = dragGroup ?? accepts ?? zoneId;

  // Root-owned optimistic order state, keyed by zone group. Each zone reads
  // its own group's entry as the rendered order. The root mutates on
  // onDragOver (arrayMove for same-zone reorder; cross-zone splice for moves).
  // A ref tracks the latest map so onDragOver/onDragEnd callbacks read fresh
  // state without stale closures.
  const [optimisticOrders, setOptimisticOrders] = React.useState<Map<string, readonly EntityRow[]>>(() => new Map());
  const optimisticOrdersRef = React.useRef(optimisticOrders);
  optimisticOrdersRef.current = optimisticOrders;
  const clearOptimisticOrder = React.useCallback((group: string) => {
    setOptimisticOrders((prev) => {
      if (!prev.has(group)) return prev;
      const next = new Map(prev);
      next.delete(group);
      return next;
    });
  }, []);

  // The orderedItems shown by this hook's consumer come from the SHARED root
  // map (local if this hook is root, parentRoot's otherwise). Fall back to the
  // raw `items` prop when nothing optimistic is stored.
  const sharedOptimistic: ReadonlyMap<string, readonly EntityRow[]> = isRoot
    ? optimisticOrders
    : parentRoot?.optimisticOrders ?? new Map();
  const optimisticEntry = sharedOptimistic.get(ownGroup);
  const orderedItems = optimisticEntry ?? items;
  // Per-render log so we can correlate splice timing with what each zone
  // actually renders. Only logs when we're in a zone (skip the root-only mode).
  if (isZone && enabled) {
    dndLog.debug('hook:render', {
      group: ownGroup,
      isRoot,
      itemsLen: (items as readonly EntityRow[]).length,
      optimisticEntryLen: optimisticEntry ? optimisticEntry.length : null,
      orderedLen: orderedItems.length,
      sharedKeys: Array.from(sharedOptimistic.keys()),
    });
  }

  // Memoize itemIds by content signature so the array reference is stable
  // across renders when IDs don't change. dnd-kit's SortableContext keeps
  // measuring the rect of each item on every items-prop change — a fresh
  // array each render means infinite measure loops on multi-list pages.
  const itemIdsSignature = orderedItems
    .map((it, idx) => {
      const raw = it[dndItemIdField];
      return raw != null ? String(raw) : `__idx_${idx}`;
    })
    .join('|');
  const itemIds = React.useMemo<UniqueIdentifier[]>(
    () =>
      orderedItems.map((it, idx) => {
        const raw = it[dndItemIdField];
        return raw != null ? String(raw) : `__idx_${idx}`;
      }),
    [itemIdsSignature],
  );

  // When the consumer's `items` prop changes content (server refetched fresh
  // data), drop this zone's optimistic order so we fall back to the new items.
  // Watch the underlying items' signature, NOT the items reference (which
  // changes every render in DataList/DataGrid).
  const itemsContentSig = items
    .map((it, idx) => {
      const raw = it[dndItemIdField];
      return raw != null ? String(raw) : `__${idx}`;
    })
    .join('|');
  React.useEffect(() => {
    const root = isRoot ? null : parentRoot;
    if (root) {
      root.clearOptimisticOrder(ownGroup);
    } else {
      // We ARE the root — clear our own entry for this group.
      clearOptimisticOrder(ownGroup);
    }
  }, [itemsContentSig, ownGroup]);

  // Root maintains a registry of zones so onDragEnd can resolve source/target
  // groups + event names. Inner zones populate it via the registerZone callback.
  const zonesRef = React.useRef<Map<string, ZoneMeta>>(new Map());
  const registerZone = React.useCallback((zoneId: string, meta: ZoneMeta) => {
    zonesRef.current.set(zoneId, meta);
  }, []);
  const unregisterZone = React.useCallback((zoneId: string) => {
    zonesRef.current.delete(zoneId);
  }, []);

  // Root tracks the currently-dragging item's source group + measured height
  // so foreign zones can render a Trello-style placeholder slot of the right
  // size while the user hovers over them.
  const [activeDrag, setActiveDrag] = React.useState<ActiveDrag | null>(null);
  const [overZoneGroup, setOverZoneGroup] = React.useState<string | null>(null);

  const meta: ZoneMeta = React.useMemo(
    () => ({ group: ownGroup, dropEvent, reorderEvent, positionEvent, itemIds, rawItems: items as readonly EntityRow[], idField: dndItemIdField }),
    [ownGroup, dropEvent, reorderEvent, positionEvent, itemIds, items, dndItemIdField],
  );

  React.useEffect(() => {
    const target = isRoot ? null : parentRoot;
    if (!target) {
      // Self-register so the root's onDragEnd can find this zone by group.
      // (Only meaningful when this zone IS the root and has its own items.)
      zonesRef.current.set(zoneId, meta);
      dndLog.debug('zone:register:self', { zoneId, group: meta.group, itemCount: meta.itemIds.length, isRoot });
      return () => {
        zonesRef.current.delete(zoneId);
        dndLog.debug('zone:unregister:self', { zoneId, group: meta.group });
      };
    }
    target.registerZone(zoneId, meta);
    dndLog.debug('zone:register', { zoneId, group: meta.group, itemCount: meta.itemIds.length, dropEvent: meta.dropEvent, reorderEvent: meta.reorderEvent });
    return () => {
      target.unregisterZone(zoneId);
      dndLog.debug('zone:unregister', { zoneId, group: meta.group });
    };
  }, [parentRoot, isRoot, zoneId, meta]);

  const sensors = useAlmadarDndSensors(true);
  const collisionDetection = almadarDndCollisionDetection;

  const findZoneByItem = React.useCallback(
    (id: UniqueIdentifier): ZoneMeta | undefined => {
      for (const z of zonesRef.current.values()) {
        if (z.itemIds.includes(id)) return z;
      }
      return undefined;
    },
    [],
  );

  const findZoneByGroup = React.useCallback(
    (group: string): ZoneMeta | undefined => {
      for (const z of zonesRef.current.values()) {
        if (z.group === group) return z;
      }
      return undefined;
    },
    [],
  );

  const handleDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      const activeIdStr = String(active.id);
      dndLog.debug('dragEnd:received', {
        activeId: active.id,
        overId: over?.id,
        overData: over?.data?.current,
      });

      // The optimistic state already reflects the final positions because
      // onDragOver mutated it on every move. Read it to compute oldIndex/
      // newIndex/sourceGroup/targetGroup.
      // Source = the zone that ORIGINALLY contained the item (find in rawItems).
      // Target = the zone that CURRENTLY contains the item in optimistic state.
      let sourceMeta: ZoneMeta | undefined;
      let oldIndex = -1;
      let targetMeta: ZoneMeta | undefined;
      let newIndex = -1;
      for (const m of zonesRef.current.values()) {
        const rawIdx = m.rawItems.findIndex((it) => String(it[m.idField]) === activeIdStr);
        if (rawIdx >= 0) {
          sourceMeta = m;
          oldIndex = rawIdx;
        }
        const currentItems = optimisticOrdersRef.current.get(m.group) ?? m.rawItems;
        const curIdx = currentItems.findIndex((it) => String(it[m.idField]) === activeIdStr);
        if (curIdx >= 0) {
          targetMeta = m;
          newIndex = curIdx;
        }
      }
      if (!sourceMeta || !targetMeta) {
        dndLog.warn('dragEnd:abort:no-zone-resolved', { activeId: active.id, hasSource: !!sourceMeta, hasTarget: !!targetMeta });
        return;
      }

      // Helper: emit positionEvent for each item in a zone's optimistic order
      // so the trait can persist a fully-renumbered position for the WHOLE
      // zone. Without this, setting only the dragged item's position causes
      // ties with the unchanged ones and sort-by-position becomes unstable.
      const emitPositions = (zoneMeta: ZoneMeta) => {
        if (!zoneMeta.positionEvent) {
          dndLog.debug('dragEnd:positions:no-event', { group: zoneMeta.group });
          return;
        }
        const evt = `UI:${zoneMeta.positionEvent}`;
        const order = optimisticOrdersRef.current.get(zoneMeta.group) ?? zoneMeta.rawItems;
        order.forEach((it, idx) => {
          const id = String(it[zoneMeta.idField]);
          const position = idx * 1000;
          eventBus.emit(evt, { id, position });
        });
        dndLog.info('dragEnd:positions:emitted', { event: evt, group: zoneMeta.group, count: order.length });
      };

      if (sourceMeta.group !== targetMeta.group) {
        if (targetMeta.dropEvent) {
          const evt = `UI:${targetMeta.dropEvent}`;
          dndLog.info('dragEnd:cross-container:emit', {
            event: evt,
            id: activeIdStr,
            sourceGroup: sourceMeta.group,
            targetGroup: targetMeta.group,
            newIndex,
          });
          eventBus.emit(evt, {
            id: activeIdStr,
            sourceGroup: sourceMeta.group,
            targetGroup: targetMeta.group,
            newIndex,
          });
        } else {
          dndLog.warn('dragEnd:cross-container:no-dropEvent-on-target', { targetGroup: targetMeta.group });
        }
        // Renumber positions for BOTH zones — source items shifted up to fill
        // the gap, target items shifted down to make room.
        emitPositions(sourceMeta);
        emitPositions(targetMeta);
        return;
      }

      // Same-zone reorder
      if (oldIndex === newIndex) {
        dndLog.debug('dragEnd:reorder:no-op', { sourceGroup: sourceMeta.group, oldIndex });
        return;
      }
      if (sourceMeta.reorderEvent) {
        const evt = `UI:${sourceMeta.reorderEvent}`;
        dndLog.info('dragEnd:reorder:emit', {
          event: evt,
          id: activeIdStr,
          oldIndex,
          newIndex,
        });
        eventBus.emit(evt, {
          id: activeIdStr,
          oldIndex,
          newIndex,
        });
      } else {
        dndLog.debug('dragEnd:reorder:no-reorderEvent', { sourceGroup: sourceMeta.group });
      }
      emitPositions(sourceMeta);
    },
    [eventBus],
  );

  const sortableData = React.useMemo(() => ({ dndGroup: ownGroup }), [ownGroup]);
  const SortableItem: React.FC<{ id: UniqueIdentifier; children: React.ReactNode }> = React.useCallback(
    ({ id, children }) => {
      const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
      } = useSortable({ id, data: sortableData });
      const { role: dndRole, ...dndAttributes } = attributes;
      const style: React.CSSProperties = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        cursor: enabled ? 'grab' : undefined,
        // Lift the dragged element above siblings so its visual movement
        // isn't hidden behind other cards / column boundaries.
        zIndex: isDragging ? 50 : undefined,
        position: isDragging ? 'relative' : undefined,
      };
      return (
        <Box
          className="touch-none"
          ref={setNodeRef as React.Ref<HTMLDivElement>}
          style={style}
          role={isAriaRole(dndRole) ? dndRole : undefined}
          {...dndAttributes}
          {...listeners}
        >
          {children}
        </Box>
      );
    },
    [sortableData, enabled],
  );

  const DropZoneShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const droppableId = `dnd-zone-${zoneId}`;
    const { setNodeRef, isOver } = useDroppable({
      id: droppableId,
      data: sortableData,
    });
    // Read the root's activeDrag so we know when to show a Trello-style
    // placeholder slot. The slot only appears when a card from a DIFFERENT
    // zone is hovering over this zone — in-zone reorder already gets the
    // SortableContext's built-in shift animation.
    const ctx = React.useContext(RootCtx);
    const activeDrag = ctx?.activeDrag ?? null;
    const overZoneGroup = ctx?.overZoneGroup ?? null;
    // Use the root-tracked overZoneGroup instead of the local useDroppable
    // `isOver` — when the pointer is over an inner SortableItem, dnd-kit
    // resolves `over` to that item (not the wrapper droppable), so the
    // shell's local isOver stays false. The root's onDragOver sees
    // over.data.dndGroup directly, which works in either case.
    const isThisZoneOver = overZoneGroup === ownGroup;
    const showForeignPlaceholder =
      isThisZoneOver && activeDrag != null && activeDrag.sourceGroup !== ownGroup;
    dndLog.debug('dropzone:render', {
      group: ownGroup,
      isOver,
      isThisZoneOver,
      overZoneGroup,
      activeDragSourceGroup: activeDrag?.sourceGroup ?? null,
      activeDragHeight: activeDrag?.height ?? null,
      showForeignPlaceholder,
      ctxAvailable: ctx != null,
    });
    React.useEffect(() => {
      dndLog.info('dropzone:isOver:change', { droppableId, group: ownGroup, isOver, isThisZoneOver, showForeignPlaceholder, activeDragSourceGroup: activeDrag?.sourceGroup ?? null });
    }, [droppableId, isOver, isThisZoneOver, showForeignPlaceholder]);
    return (
      <Box
        ref={setNodeRef as React.Ref<HTMLDivElement>}
        data-dnd-zone={ownGroup}
        data-dnd-is-over={isThisZoneOver ? 'true' : 'false'}
        className={
          isThisZoneOver
            ? 'ring-2 ring-primary/40 ring-offset-2 rounded-container transition-all min-h-[3rem]'
            : 'min-h-[3rem] rounded-container transition-all'
        }
      >
        {children}
      </Box>
    );
  };

  const rootContextValue: RootContext = React.useMemo(
    () => ({ registerZone, unregisterZone, activeDrag, overZoneGroup, optimisticOrders, clearOptimisticOrder }),
    [registerZone, unregisterZone, activeDrag, overZoneGroup, optimisticOrders, clearOptimisticOrder],
  );

  const handleDragStart = React.useCallback((event: DragStartEvent) => {
    const sourceZone = findZoneByItem(event.active.id);
    // Measure the actual source DOM height so the placeholder slot matches
    // visually. activatorNode is the [data-dnd-item] wrapper; fall back to
    // a sensible default if dnd-kit hasn't measured it yet.
    const rect = event.active.rect.current.initial;
    const height = rect?.height && rect.height > 0 ? rect.height : 64;
    if (sourceZone) {
      setActiveDrag({ sourceGroup: sourceZone.group, height });
      dndLog.info('dragStart:activeDrag:set', { sourceGroup: sourceZone.group, height, isRoot, hookZoneId: zoneId });
    } else {
      dndLog.warn('dragStart:no-source-zone', { activeId: event.active.id, zoneCount: zonesRef.current.size, isRoot });
    }
    dndLog.info('dragStart', {
      activeId: event.active.id,
      activeData: event.active.data?.current,
      sourceGroup: sourceZone?.group,
      height,
      zoneCount: zonesRef.current.size,
      isRoot,
    });
  }, [findZoneByItem, isRoot, zoneId]);

  const handleDragOver = React.useCallback((event: DragOverEvent) => {
    const { active, over } = event;
    const overData = over?.data?.current as { dndGroup?: string } | undefined;
    const overGroup = overData?.dndGroup ?? null;
    setOverZoneGroup(overGroup);

    if (!over || !overGroup) return;
    // Find the source zone by searching the optimistic + raw items for active.id.
    // We must walk via zonesRef because optimisticOrders may not yet contain
    // every zone (only zones that have been mutated have entries).
    const activeIdStr = String(active.id);
    let sourceMeta: ZoneMeta | undefined;
    let sourceGroup: string | undefined;
    for (const m of zonesRef.current.values()) {
      const currentItems = optimisticOrdersRef.current.get(m.group) ?? m.rawItems;
      const found = currentItems.find((it) => String(it[m.idField]) === activeIdStr);
      if (found) {
        sourceMeta = m;
        sourceGroup = m.group;
        break;
      }
    }
    if (!sourceMeta || !sourceGroup) {
      dndLog.debug('dragOver:no-source-zone', { activeId: active.id });
      return;
    }
    // Find the target zone meta by group
    let targetMeta: ZoneMeta | undefined;
    for (const m of zonesRef.current.values()) {
      if (m.group === overGroup) {
        targetMeta = m;
        break;
      }
    }
    if (!targetMeta) {
      dndLog.debug('dragOver:no-target-zone', { overGroup });
      return;
    }

    if (sourceGroup === overGroup) {
      // Same-zone reorder: arrayMove items at indices [activeIdx, overIdx].
      setOptimisticOrders((prev) => {
        const currentItems = prev.get(sourceGroup!) ?? sourceMeta!.rawItems;
        const oldIndex = currentItems.findIndex((it) => String(it[sourceMeta!.idField]) === activeIdStr);
        const newIndex = currentItems.findIndex((it) => String(it[sourceMeta!.idField]) === String(over.id));
        if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return prev;
        const reordered = arrayMove([...currentItems] as EntityRow[], oldIndex, newIndex);
        const next = new Map(prev);
        next.set(sourceGroup!, reordered);
        return next;
      });
      return;
    }

    // Cross-zone splice: remove active from source, insert into target at the
    // over-id's index (or at the end when over is the zone shell itself).
    setOptimisticOrders((prev) => {
      const currentSource = prev.get(sourceGroup!) ?? sourceMeta!.rawItems;
      const currentTarget = prev.get(overGroup) ?? targetMeta!.rawItems;
      const activeItem = currentSource.find((it) => String(it[sourceMeta!.idField]) === activeIdStr);
      if (!activeItem) return prev;
      // Already in target? (multi-fire onDragOver) — skip if active already in target.
      if (currentTarget.some((it) => String(it[targetMeta!.idField]) === activeIdStr)) {
        return prev;
      }
      const newSource = currentSource.filter((it) => String(it[sourceMeta!.idField]) !== activeIdStr);
      const overIdStr = String(over.id);
      const overIndex = currentTarget.findIndex((it) => String(it[targetMeta!.idField]) === overIdStr);
      const insertAt = overIndex >= 0 ? overIndex : currentTarget.length;
      const newTarget: EntityRow[] = [
        ...(currentTarget.slice(0, insertAt) as EntityRow[]),
        activeItem as EntityRow,
        ...(currentTarget.slice(insertAt) as EntityRow[]),
      ];
      const next = new Map(prev);
      next.set(sourceGroup!, newSource);
      next.set(overGroup, newTarget);
      dndLog.debug('dragOver:cross-zone:splice', { sourceGroup, overGroup, sourceLen: newSource.length, targetLen: newTarget.length, insertAt });
      return next;
    });
  }, []);

  const handleDragCancel = React.useCallback((event: DragCancelEvent) => {
    setActiveDrag(null);
    setOverZoneGroup(null);
    dndLog.warn('dragCancel', {
      activeId: event.active.id,
      reason: 'dnd-kit cancelled the drag (escape key, pointer interrupted, or external)',
    });
  }, []);

  // Wrap handleDragEnd to also clear placeholder state so the slot disappears.
  const handleDragEndWithCleanup = React.useCallback((event: DragEndEvent) => {
    handleDragEnd(event);
    setActiveDrag(null);
    setOverZoneGroup(null);
  }, [handleDragEnd]);

  const wrapContainer = React.useCallback(
    (children: React.ReactNode): React.ReactNode => {
      if (!enabled) return children;
      const strategy = layout === 'grid' ? rectSortingStrategy : verticalListSortingStrategy;
      // Root-only mode: container hosts DndContext for descendant zones but is
      // not itself a sortable or drop target.
      if (!isZone) {
        if (!isRoot) return children;
        return (
          <RootCtx.Provider value={rootContextValue}>
            <DndContext
              sensors={sensors}
              collisionDetection={collisionDetection}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEndWithCleanup}
              onDragCancel={handleDragCancel}
            >
              {children}
            </DndContext>
          </RootCtx.Provider>
        );
      }
      const inner = (
        <DropZoneShell>
          <SortableContext items={itemIds} strategy={strategy}>
            {children}
          </SortableContext>
        </DropZoneShell>
      );
      if (isRoot) {
        return (
          <RootCtx.Provider value={rootContextValue}>
            <DndContext
              sensors={sensors}
              collisionDetection={collisionDetection}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEndWithCleanup}
              onDragCancel={handleDragCancel}
            >
              {inner}
            </DndContext>
          </RootCtx.Provider>
        );
      }
      return inner;
    },
    [enabled, isZone, layout, sensors, collisionDetection, handleDragStart, handleDragOver, handleDragEndWithCleanup, handleDragCancel, itemIds, isRoot, rootContextValue],
  );

  return {
    enabled,
    isZone,
    wrapContainer,
    SortableItem,
    orderedItems,
  };
}
