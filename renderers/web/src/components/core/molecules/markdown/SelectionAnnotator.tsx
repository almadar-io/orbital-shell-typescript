'use client';
/**
 * SelectionAnnotator Molecule
 *
 * Wraps rendered content. While the reader has a non-collapsed text selection
 * inside it, shows a small action bar (Ask / Note) that emits the declared
 * events with `{ selectedText }`. The bar is rendered right after the content
 * in DOM order, so it is also reachable by keyboard after a keyboard selection
 * (Shift+Arrows, then Tab). Escape dismisses it.
 *
 * Event Contract:
 * - Emits: UI:{askEvent} { selectedText }
 * - Emits: UI:{noteEvent} { selectedText }
 * - entityAware: false
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { A11yProps, EventEmit } from '@almadar/core';
import { Box } from '../../../../core';
import { Button } from '../../../../core';
import { HStack } from '../../../../core';
import { cn } from '../../../../core';
import { useEventBus } from '../../../../core';
import { useTranslate } from '../../../../core';
import { domPassthrough } from '../../../../core';

export interface SelectionAnnotatorProps extends A11yProps {
  /** Event emitted by the Ask action (as `UI:<askEvent>`) */
  askEvent?: EventEmit<{ selectedText: string }>;
  /** Event emitted by the Note action (as `UI:<noteEvent>`) */
  noteEvent?: EventEmit<{ selectedText: string }>;
  /** Ask action label (default: translated `selection.ask`) */
  askLabel?: string;
  /** Note action label (default: translated `selection.note`) */
  noteLabel?: string;
  /** Additional CSS classes */
  className?: string;
  children?: React.ReactNode;
}

interface ActiveSelection {
  text: string;
  top: number;
  left: number;
}

export const SelectionAnnotator: React.FC<SelectionAnnotatorProps> = ({
  askEvent,
  noteEvent,
  askLabel,
  noteLabel,
  className,
  children,
  ...rest
}) => {
  const { t } = useTranslate();
  const { emit } = useEventBus();
  const containerRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<ActiveSelection | null>(null);
  const enabled = askEvent !== undefined || noteEvent !== undefined;

  useEffect(() => {
    if (!enabled) return undefined;
    const onSelectionChange = () => {
      const container = containerRef.current;
      const selection = document.getSelection();
      if (!container || !selection) return;
      const text = selection.toString().trim();
      if (selection.rangeCount > 0 && !selection.isCollapsed && text.length > 0) {
        const range = selection.getRangeAt(0);
        if (container.contains(range.commonAncestorContainer)) {
          const box = range.getBoundingClientRect();
          const origin = container.getBoundingClientRect();
          setActive({ text, top: box.bottom - origin.top, left: box.left - origin.left });
          return;
        }
      }
      if (barRef.current?.contains(document.activeElement)) return;
      setActive(null);
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, [enabled]);

  const fire = useCallback(
    (event: string | undefined) => {
      if (!event || !active) return;
      emit(`UI:${event}`, { selectedText: active.text });
      document.getSelection()?.removeAllRanges();
      setActive(null);
    },
    [active, emit],
  );

  const dismiss = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') setActive(null);
  };

  if (!enabled) return <>{children}</>;

  return (
    <Box
      {...domPassthrough(rest)}
      ref={containerRef}
      position="relative"
      className={className}
      onKeyDown={dismiss}
    >
      {children}
      {active ? (
        <Box
          ref={barRef}
          role="toolbar"
          aria-label={t('selection.toolbar')}
          position="absolute"
          className={cn(
            'z-10 bg-card rounded-interactive border border-border p-1',
            'shadow-elevation-popover transition-opacity duration-fast',
          )}
          style={{ top: active.top + 4, left: active.left }}
          onMouseDown={(e: React.MouseEvent) => e.preventDefault()}
        >
          <HStack gap="xs">
            {askEvent ? (
              <Button variant="ghost" size="sm" onClick={() => fire(askEvent)}>
                {askLabel ?? t('selection.ask')}
              </Button>
            ) : null}
            {noteEvent ? (
              <Button variant="ghost" size="sm" onClick={() => fire(noteEvent)}>
                {noteLabel ?? t('selection.note')}
              </Button>
            ) : null}
          </HStack>
        </Box>
      ) : null}
    </Box>
  );
};

SelectionAnnotator.displayName = 'SelectionAnnotator';
