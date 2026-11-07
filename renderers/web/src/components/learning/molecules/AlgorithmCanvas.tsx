'use client';

/**
 * AlgorithmCanvas
 *
 * A field-scoped learning molecule for algorithms: bars, cells, pointers, ranges, slots, frames and buckets, mapped
 * and drawn by orbital-canvas.
 *
 * @packageDocumentation
 */

import * as React from 'react';
import { useMemo } from 'react';
import type { A11yProps, EventKey, PatternConfig } from '@almadar/core';
import { domPassthrough } from '../../../core';
import { Card, Typography } from '../../../core';
import { VStack } from '../../../core';
import { LearningCanvasState, shapeClickCallbacks } from '../atoms/LearningCanvas';
import type { LearningPoint, LearningReadout, LearningShape, LearningTracePanel } from '../atoms/LearningCanvas';
import type { UiError } from '../../../core';
import { OrbitalSceneCanvas } from '../../../lib/drawable/orbital/OrbitalSceneCanvas';

export interface AlgorithmBar {
  value: number;
  color?: string;
  label?: string;
}

/** Small per-corner annotation texts inside a cell (e.g. DP transition sources). */
export interface AlgorithmCellCorner {
  tl?: string;
  tr?: string;
  bl?: string;
  br?: string;
}

export interface AlgorithmCell {
  row: number;
  col: number;
  value?: number;
  color?: string;
  label?: string;
  /** Small annotation texts in the four corners; rendered only when the cell is large enough. */
  corner?: AlgorithmCellCorner;
}

export interface AlgorithmPointer {
  index: number;
  label?: string;
  color?: string;
}

/** A highlighted span over the bars panel: a translucent fill band or a bracket with a label. */
export interface AlgorithmRange {
  from: number;
  to: number;
  color?: string;
  label?: string;
  kind?: 'fill' | 'bracket';
}

/** Fill state for a single slot box. */
export type AlgorithmSlotState = 'empty' | 'filled' | 'highlight';

/** A discrete value slot (register/variable) drawn as a labeled box. */
export interface AlgorithmSlot {
  value?: string | number;
  state?: AlgorithmSlotState;
  color?: string;
}

/** Lifecycle state for a call-stack frame. */
export type AlgorithmFrameState = 'active' | 'returning' | 'done';

/** A single call-stack frame (recursion visualization). */
export interface AlgorithmFrame {
  label: string;
  detail?: string;
  state?: AlgorithmFrameState;
  color?: string;
}

/** Highlight state for a single bucket entry (hash-table chaining). */
export type AlgorithmBucketEntryState = 'default' | 'highlight' | 'probing';

/** A single chained entry within a hash-table bucket. */
export interface AlgorithmBucketEntry {
  label: string;
  state?: AlgorithmBucketEntryState;
  color?: string;
}

/** A hash-table bucket row: an index plus its chain of entries. */
export interface AlgorithmBucket {
  index: number;
  entries: AlgorithmBucketEntry[];
}

/** A row/column header label for the cells grid. */
export interface AlgorithmAxisLabel {
  index: number;
  text: string;
  color?: string;
}

export interface AlgorithmCanvasProps extends Omit<React.AriaAttributes, keyof A11yProps>, A11yProps {
  className?: string;
  width?: number;
  height?: number;
  title?: string;
  backgroundColor?: string;
  /** Overrides the theme's categorical palette (`series-1…N`) for this canvas — real-world conventions like CPK atom colors or resistor bands. Unset, the theme's `--color-series-*` apply. */
  series?: string[];
  /** Maps a keydown `e.code` (optionally `Mod+`/`Shift+`/`Alt+` prefixed) to a SEMANTIC event emitted as `UI:{event}` — e.g. `{ Space: TOGGLE_RUN, ArrowRight: STEP, KeyR: RESET }`; keystrokes inside inputs never route. */
  keyMap?: Record<string, EventKey>;
  /** Maps a keyup `e.code` to a semantic event emitted as `UI:{event}`. */
  keyUpMap?: Record<string, EventKey>;
  /** Sorting/histogram bars; laid out left-to-right, height proportional to value. */
  bars?: AlgorithmBar[];
  /** Grid/array/DP cells; laid out on a row/col lattice sized to the extent. */
  cells?: AlgorithmCell[];
  /** Index cursors (i/j/lo/hi/mid); drawn as markers beneath the referenced bar/slot column. */
  pointers?: AlgorithmPointer[];
  /** Highlighted index ranges over the bars panel (translucent fill bands or labeled brackets). */
  ranges?: AlgorithmRange[];
  /** Discrete value slots (registers/variables); laid out in a row or a vertical stack. */
  slots?: AlgorithmSlot[];
  /** Slot stack direction; horizontal lays slots left-to-right, vertical stacks bottom-up. */
  slotOrientation?: 'horizontal' | 'vertical';
  /** Recursion/call-stack frames; laid out bottom-up like a real call stack. */
  frames?: AlgorithmFrame[];
  /** Hash-table buckets; each row is an index chip plus its chained entries. */
  buckets?: AlgorithmBucket[];
  /** Secondary bar strip inside the bars panel (e.g. a running total beside the primary values). */
  auxBars?: AlgorithmBar[];
  /** Row-header labels drawn to the left of the cells grid. */
  rowLabels?: AlgorithmAxisLabel[];
  /** Column-header labels drawn above the cells grid. */
  colLabels?: AlgorithmAxisLabel[];
  /** Extra declarative shapes in canvas pixel coordinates. */
  shapes?: LearningShape[];
  interactive?: boolean;
  animate?: boolean;
  onShapeClick?: (payload: { id?: string; type?: string; index: number }) => void;
  isLoading?: boolean;
  error?: UiError | null;
}


export const AlgorithmCanvas: React.FC<AlgorithmCanvasProps> = ({
  className,
  title,
  width = 600,
  height = 400,
  backgroundColor,
  series,
  keyMap,
  keyUpMap,
  bars = [],
  cells = [],
  pointers = [],
  ranges = [],
  slots = [],
  slotOrientation = 'horizontal',
  frames = [],
  buckets = [],
  auxBars = [],
  rowLabels = [],
  colLabels = [],
  shapes = [],
  interactive = false,
  animate = false,
  onShapeClick,
  isLoading,
  error,
  ...rest
}) => {
  const config = useMemo<PatternConfig<'algorithm-canvas'>>(
    () => ({
      type: 'algorithm-canvas',
      width,
      height,
      backgroundColor,
      series,
      keyMap,
      keyUpMap,
      bars,
      cells,
      pointers,
      ranges,
      slots,
      slotOrientation,
      frames,
      buckets,
      auxBars,
      rowLabels,
      colLabels,
      shapes,
      interactive,
      animate,
    }),
    [width, height, backgroundColor, series, keyMap, keyUpMap, bars, cells, pointers, ranges, slots, slotOrientation, frames, buckets, auxBars, rowLabels, colLabels, shapes, interactive, animate],
  );
  const callbacks = useMemo(() => shapeClickCallbacks(onShapeClick), [onShapeClick]);

  if (isLoading || error) {
    return (
      <Card {...domPassthrough(rest)} className={className}>
        <VStack gap="sm">
          {title ? <Typography variant="h4">{title}</Typography> : null}
          <LearningCanvasState width={width ?? 600} height={height ?? 400} isLoading={isLoading} error={error} />
        </VStack>
      </Card>
    );
  }

  return (
    <Card {...domPassthrough(rest)} className={className}>
      <VStack gap="sm">
        {title ? <Typography variant="h4">{title}</Typography> : null}
        <OrbitalSceneCanvas pattern="algorithm-canvas" config={config} width={width ?? 600} height={height ?? 400} callbacks={callbacks} keyMap={keyMap} keyUpMap={keyUpMap} />
      </VStack>
    </Card>
  );
};
