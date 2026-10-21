'use client';
/**
 * useDragReorder Hook
 *
 * Manages drag-to-reorder state for a list of items.
 * Uses pointer events (not HTML5 drag API) for mobile compatibility.
 * Components route the result through useEventBus().emit('UI:EVENT_NAME', payload).
 */
import { useCallback, useRef, useState } from 'react';
import type React from 'react';

export interface DragReorderResult<T> {
  /** The reordered items array */
  items: T[];
  /** Index of the item currently being dragged (-1 if not dragging) */
  dragIndex: number;
  /** Index of the drop target (-1 if not over any target) */
  dragOverIndex: number;
  /** Whether a drag is in progress */
  isDragging: boolean;
  /** Props to spread on the drag handle element for a given index */
  getDragHandleProps: (index: number) => {
    onPointerDown: (e: React.PointerEvent) => void;
    style: React.CSSProperties;
    'aria-grabbed': boolean;
    role: 'button';
  };
  /** Props to spread on each list item for a given index */
  getItemProps: (index: number) => {
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: () => void;
    'aria-dropeffect': string;
    style: React.CSSProperties;
  };
}

export function useDragReorder<T>(
  initialItems: T[],
  onReorder: (fromIndex: number, toIndex: number, item: T) => void,
): DragReorderResult<T> {
  const [items, setItems] = useState<T[]>(initialItems);
  const [dragIndex, setDragIndex] = useState(-1);
  const [dragOverIndex, setDragOverIndex] = useState(-1);

  const itemsRef = useRef(initialItems);

  // Sync if external items change
  if (initialItems !== itemsRef.current) {
    itemsRef.current = initialItems;
    setItems(initialItems);
  }

  const isDragging = dragIndex >= 0;

  const handleDragStart = useCallback((index: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    setDragIndex(index);
    setDragOverIndex(index);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }, []);

  const handleDragMove = useCallback((index: number) => (e: React.PointerEvent) => {
    if (dragIndex < 0) return;
    // Determine which item we're over based on the pointer position
    const target = document.elementFromPoint(e.clientX, e.clientY);
    if (!target) return;

    // Walk up to find the nearest element with data-drag-index
    let el: HTMLElement | null = target as HTMLElement;
    while (el && !el.dataset.dragIndex) {
      el = el.parentElement;
    }
    if (el?.dataset.dragIndex) {
      const overIndex = parseInt(el.dataset.dragIndex, 10);
      if (!isNaN(overIndex) && overIndex !== dragOverIndex) {
        setDragOverIndex(overIndex);
      }
    }
  }, [dragIndex, dragOverIndex]);

  const handleDragEnd = useCallback(() => {
    if (dragIndex >= 0 && dragOverIndex >= 0 && dragIndex !== dragOverIndex) {
      const newItems = [...items];
      const [movedItem] = newItems.splice(dragIndex, 1);
      newItems.splice(dragOverIndex, 0, movedItem);
      setItems(newItems);
      onReorder(dragIndex, dragOverIndex, items[dragIndex]);
    }
    setDragIndex(-1);
    setDragOverIndex(-1);
  }, [dragIndex, dragOverIndex, items, onReorder]);

  const getDragHandleProps = useCallback((index: number) => ({
    onPointerDown: handleDragStart(index),
    style: { cursor: 'grab', touchAction: 'none' as const } as React.CSSProperties,
    'aria-grabbed': dragIndex === index,
    role: 'button' as const,
  }), [handleDragStart, dragIndex]);

  const getItemProps = useCallback((index: number) => ({
    onPointerMove: handleDragMove(index),
    onPointerUp: handleDragEnd,
    'aria-dropeffect': 'move' as const,
    'data-drag-index': String(index),
    style: {
      opacity: dragIndex === index ? 0.5 : 1,
      transition: isDragging ? 'transform 150ms ease' : undefined,
      transform: isDragging && dragOverIndex >= 0
        ? index === dragIndex
          ? 'scale(1.02)'
          : index > dragIndex && index <= dragOverIndex
            ? 'translateY(-100%)'
            : index < dragIndex && index >= dragOverIndex
              ? 'translateY(100%)'
              : undefined
        : undefined,
    } as React.CSSProperties,
  }), [handleDragMove, handleDragEnd, dragIndex, dragOverIndex, isDragging]);

  return {
    items,
    dragIndex,
    dragOverIndex,
    isDragging,
    getDragHandleProps,
    getItemProps,
  };
}
