'use client';

/**
 * useDraggable Hook
 *
 * Generic drag-source hook wrapping the HTML5 Drag & Drop API.
 * Returns props to spread onto a draggable element and tracks whether it is dragging.
 */

import { useState, useCallback, useMemo } from 'react';
import type { EventPayload } from '@almadar/core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Discriminated payload carried by every drag operation. */
export interface DraggablePayload {
  kind: 'pattern' | 'behavior' | 'tree-node' | 'event-wire';
  data: EventPayload;
}

export interface UseDraggableOptions {
  /** The payload that will be serialised into dataTransfer. */
  payload: DraggablePayload;
  /** When true the element cannot be dragged. */
  disabled?: boolean;
}

export interface UseDraggableResult {
  /** Spread these onto the draggable element. */
  dragProps: {
    draggable: boolean;
    onDragStart: (e: React.DragEvent) => void;
    onDragEnd: (e: React.DragEvent) => void;
    'aria-grabbed': boolean;
  };
  /** True while the element is being dragged. */
  isDragging: boolean;
}

// ---------------------------------------------------------------------------
// MIME type used for all Almadar DnD operations
// ---------------------------------------------------------------------------

export const ALMADAR_DND_MIME = 'application/x-almadar-dnd';

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDraggable({ payload, disabled = false }: UseDraggableOptions): UseDraggableResult {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      if (disabled) {
        e.preventDefault();
        return;
      }
      e.dataTransfer.setData(ALMADAR_DND_MIME, JSON.stringify(payload));
      e.dataTransfer.effectAllowed = 'copy';
      setIsDragging(true);
    },
    [disabled, payload],
  );

  const handleDragEnd = useCallback(
    (e: React.DragEvent) => {
      void e;
      setIsDragging(false);
    },
    [],
  );

  const dragProps = useMemo(
    () => ({
      draggable: !disabled,
      onDragStart: handleDragStart,
      onDragEnd: handleDragEnd,
      'aria-grabbed': isDragging,
    }),
    [disabled, handleDragStart, handleDragEnd, isDragging],
  );

  return { dragProps, isDragging };
}
