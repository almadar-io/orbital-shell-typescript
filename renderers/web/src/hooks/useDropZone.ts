'use client';

/**
 * useDropZone Hook
 *
 * Generic drop-target hook wrapping the HTML5 Drag & Drop API.
 * Parses the structured DraggablePayload from dataTransfer,
 * validates it against an `accepts` filter, and calls `onDrop`
 * with the typed payload and mouse position.
 *
 * Event Contract:
 * - Emits: UI:DROP { kind, data, x, y }
 */

import { useState, useCallback, useMemo } from 'react';
import type { FieldValue } from '@almadar/core';
import { useEventBus } from '../core';
import { ALMADAR_DND_MIME, type DraggablePayload } from './useDraggable';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseDropZoneOptions {
  /** Which payload kinds this zone accepts. */
  accepts: DraggablePayload['kind'][];
  /** Called when a valid payload is dropped. */
  onDrop: (payload: DraggablePayload, position: { x: number; y: number }) => void;
  /** When true the zone rejects all drops. */
  disabled?: boolean;
}

export interface UseDropZoneResult {
  /** Spread these onto the drop-target element. */
  dropProps: {
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
  };
  /** True while a valid drag payload is hovering over this zone. */
  isOver: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parsePayload(e: React.DragEvent): DraggablePayload | null {
  try {
    const raw = e.dataTransfer.getData(ALMADAR_DND_MIME);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { kind?: string; data?: FieldValue };
    if (typeof parsed.kind !== 'string' || !parsed.data) return null;
    return parsed as DraggablePayload;
  } catch {
    return null;
  }
}

/**
 * During dragover the browser restricts getData() access.
 * We can only check whether our MIME type is present in the types list.
 */
function hasAlmadarPayload(e: React.DragEvent): boolean {
  return e.dataTransfer.types.includes(ALMADAR_DND_MIME);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDropZone({ accepts, onDrop, disabled = false }: UseDropZoneOptions): UseDropZoneResult {
  const [isOver, setIsOver] = useState(false);
  const eventBus = useEventBus();

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (disabled) return;
      if (!hasAlmadarPayload(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setIsOver(true);
    },
    [disabled],
  );

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      void e;
      setIsOver(false);
    },
    [],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsOver(false);

      if (disabled) return;

      const payload = parsePayload(e);
      if (!payload) return;
      if (!accepts.includes(payload.kind)) return;

      const position = { x: e.clientX, y: e.clientY };
      onDrop(payload, position);
      eventBus.emit('UI:DROP', { kind: payload.kind, data: payload.data, ...position });
    },
    [disabled, accepts, onDrop, eventBus],
  );

  const dropProps = useMemo(
    () => ({
      onDragOver: handleDragOver,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
    }),
    [handleDragOver, handleDragLeave, handleDrop],
  );

  return { dropProps, isOver };
}
