/**
 * ScaledDiagram Molecule
 *
 * Wraps a fixed-size diagram (like JazariStateMachine / StateMachineView)
 * and CSS-scales it to fit the parent container width.
 *
 * The diagram renders at its natural (large) size. We observe the content
 * element and once the diagram is measured we apply transform:scale() with
 * a corrected container height so surrounding layout flows correctly.
 *
 * Event Contract:
 * - No events emitted (layout-only wrapper)
 * - entityAware: false
 */

import type { A11yProps } from '@almadar/core';
import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Box } from '../../../core';
import { useTranslate } from '../../../core';
import { cn } from '../../../core';

import { domPassthrough } from '../../../core';
export interface ScaledDiagramProps extends A11yProps {
  children: React.ReactNode;
  className?: string;
}

/** The nearest descendants that lay out a box: slot wrappers render `display: contents` and have no width. */
function boxedChildren(el: Element): HTMLElement[] {
  return [...el.children].flatMap((child) =>
    child instanceof HTMLElement && getComputedStyle(child).display !== 'contents' ? [child] : boxedChildren(child),
  );
}

/** Minimum diagram width (px) to consider it a real diagram worth scaling. */
const MIN_DIAGRAM_WIDTH = 200;

export const ScaledDiagram: React.FC<ScaledDiagramProps> = ({
  children,
  className,
  ...rest
}) => {
  const { t: _t, direction } = useTranslate();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<{
    scale: number;
    height: number;
  } | null>(null);

  const measure = useCallback(() => {
    const wrapper = wrapperRef.current;
    const content = contentRef.current;
    if (!wrapper || !content) return;

    const containerW = wrapper.clientWidth;
    if (containerW <= 0) return;

    // Walk children to find a diagram element with an explicit pixel
    // width set via inline style (StateMachineView does this).
    let diagramW = 0;
    let diagramH = 0;

    const children = boxedChildren(content);
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const w = child.style?.width;
      const h = child.style?.height;
      if (w && /^\d+/.test(w) && h && /^\d+/.test(h)) {
        diagramW = parseFloat(w);
        diagramH = parseFloat(h);
        break;
      }
      // Also check offsetWidth for elements that might have explicit size
      if (child.offsetWidth > MIN_DIAGRAM_WIDTH) {
        diagramW = child.offsetWidth;
        diagramH = child.offsetHeight;
        break;
      }
    }

    // If no sizable child found, don't apply scaling
    if (diagramW < MIN_DIAGRAM_WIDTH || diagramH <= 0) {
      setLayout((prev) => (prev === null ? prev : null));
      return;
    }

    const s = Math.min(1, containerW / diagramW);
    const height = diagramH * s;
    setLayout((prev) => (prev !== null && prev.scale === s && prev.height === height ? prev : { scale: s, height }));
  }, []);

  // Measure after children mount/change
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;

    // Double-rAF for initial paint
    let raf1 = requestAnimationFrame(() => {
      requestAnimationFrame(() => measure());
    });

    // Re-measure when the content changes size (a lazily mounted diagram grows it). Not per DOM
    // mutation: a playing demo rewrites attributes every tick, and measuring forces a layout.
    const ro = new ResizeObserver(() => measure());
    ro.observe(content);

    return () => {
      cancelAnimationFrame(raf1);
      ro.disconnect();
    };
  }, [measure, children]);

  // Re-measure on container resize
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(wrapper);
    return () => ro.disconnect();
  }, [measure]);

  const hasLayout = layout !== null;

  return (
    <Box
      {...domPassthrough(rest)}
      ref={wrapperRef}
      className={cn('w-full', className)}
      style={{
        // Only clip overflow once we have a valid measurement
        overflow: hasLayout ? 'hidden' : undefined,
        height: hasLayout ? layout.height : undefined,
      }}
    >
      <Box
        ref={contentRef}
        style={{
          width: 'max-content',
          // RTL content overflows to the left, so it shrinks toward its right edge.
          transformOrigin: direction === 'rtl' ? 'top right' : 'top left',
          transform: hasLayout && layout.scale < 1
            ? `scale(${layout.scale})`
            : undefined,
        }}
      >
        {children}
      </Box>
    </Box>
  );
};

ScaledDiagram.displayName = 'ScaledDiagram';
