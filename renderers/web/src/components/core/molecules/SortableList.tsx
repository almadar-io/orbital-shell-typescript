'use client';

/**
 * SortableList — drag-to-reorder list (distinct from DataList).
 * DataList is a read/action list with no drag. SortableList owns drag
 * handles and emits a REORDER event with fromIndex/toIndex/item — use it
 * when item ordering is user-controlled.
 */
import React, { useCallback } from 'react';
import type { A11yProps, EntityRow, EventEmit, EventPayload } from "@almadar/core";
import { cn } from '../../../core';
import { useEventBus } from '../../../core';
import { useDragReorder } from '../../../hooks/useDragReorder';
import { Box } from '../../../core';
import { domPassthrough } from '../../../core';
import { HStack } from '../../../core';
import { VStack } from '../../../core';
import { Icon } from '../../../core';

const EMPTY_ITEMS: readonly EntityRow[] = [];

/**
 * SortableList — a drag-and-drop reorderable list of items.
 *
 * @capabilities checklist, task list, to-do list, priority list, ranked list, drag-to-reorder queue
 */
export interface SortableListProps extends A11yProps {
  items: readonly EntityRow[];
  /** Render function for each item. In .lolo: renderItem: (fn item <Component …={@item.field}/>), binding per-item fields via @item.field. */
  renderItem: (item: EntityRow, index: number) => React.ReactNode;
  /** @entityRow item */
  reorderEvent: EventEmit<{ fromIndex: number; toIndex: number; item: EntityRow }>;
  /** @payloadFor reorderEvent */
  reorderPayload?: EventPayload;
  dragHandlePosition?: 'left' | 'right';
  className?: string;
}

function useSafeEventBus() {
  try {
    return useEventBus();
  } catch {
    return { emit: () => {}, on: () => () => {}, once: () => {} };
  }
}

function SortableListInner({
  items: initialItemsProp = EMPTY_ITEMS,
  renderItem,
  reorderEvent,
  reorderPayload,
  dragHandlePosition = 'left',
  className,
  ...rest
}: SortableListProps) {
  const eventBus = useSafeEventBus();

  const initialItems = Array.isArray(initialItemsProp) ? initialItemsProp : initialItemsProp ? [initialItemsProp] : [];

  const handleReorder = useCallback(
    (fromIndex: number, toIndex: number, item: EntityRow) => {
      eventBus.emit(`UI:${reorderEvent}`, {
        fromIndex,
        toIndex,
        item,
        ...reorderPayload,
      });
    },
    [eventBus, reorderEvent, reorderPayload],
  );

  const {
    items,
    dragIndex,
    dragOverIndex,
    isDragging,
    getDragHandleProps,
    getItemProps,
  } = useDragReorder<EntityRow>(initialItems, handleReorder);

  return (
    <VStack {...domPassthrough(rest)} gap="none" className={cn('w-full', className)}>
      {items.map((item, index) => {
        const { 'aria-dropeffect': ariaDropEffect, ...itemProps } = getItemProps(index);
        const { 'aria-grabbed': ariaGrabbed, ...handleRest } = getDragHandleProps(index);
        const isBeingDragged = dragIndex === index;
        const showDropIndicator =
          isDragging &&
          dragOverIndex === index &&
          dragOverIndex !== dragIndex;

        const dragHandle = (
          <Box
            className={cn(
              'flex items-center justify-center',
              'text-muted-foreground',
              'hover:text-foreground',
              'transition-colors duration-instant',
              'px-1',
            )}
            aria-grabbed={ariaGrabbed}
            {...handleRest}
          >
            <Icon name="grip-vertical" size="sm" />
          </Box>
        );

        return (
          <Box
            key={index}
            aria-dropeffect={ariaDropEffect as React.AriaAttributes['aria-dropeffect']}
            {...itemProps}
          >
            {/* Drop indicator line above this item */}
            {showDropIndicator && (
              <Box
                className="h-0.5 bg-primary rounded-full"
                style={{ margin: '0 8px' }}
              />
            )}

            <HStack
              gap="sm"
              align="center"
              className={cn(
                'transition-opacity duration-fast',
                isBeingDragged && 'opacity-50',
              )}
            >
              {dragHandlePosition === 'left' && dragHandle}

              <Box className="flex-1 min-w-0">
                {typeof renderItem === 'function' ? renderItem(item, index) : JSON.stringify(item)}
              </Box>

              {dragHandlePosition === 'right' && dragHandle}
            </HStack>
          </Box>
        );
      })}
    </VStack>
  );
}

export const SortableList = SortableListInner;

(SortableList as React.FC).displayName = 'SortableList';
