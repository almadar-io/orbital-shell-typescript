'use client';

/**
 * MathCanvas
 *
 * A field-scoped learning molecule for math: axes, grid, curves, points, vectors, regions, bars, guides, angles,
 * hops and game drawables in plot coordinates, mapped and drawn by orbital-canvas.
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
import type { DrawableNode } from '../../../lib/drawable/paintDispatch';

export interface MathCurve {
  label?: string;
  color?: string;
  /** Sampled {x,y} points in math coordinates. */
  samples: LearningPoint[];
  /** Stroke dash style for this curve's segments; 'solid' or omit for a solid line. */
  dash?: 'solid' | 'dashed' | 'dotted';
}

export interface MathPoint {
  x: number;
  y: number;
  label?: string;
  color?: string;
  radius?: number;
  /** 'open' draws a hollow ring (white fill, colored stroke); 'closed'/absent = filled dot. */
  style?: 'closed' | 'open';
}

export interface MathVector {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color?: string;
  label?: string;
}

/** A filled area between a curve and a baseline, or between two curves. */
export interface MathRegion {
  /** Upper (or only) boundary samples. */
  samples: LearningPoint[];
  /** Optional lower boundary samples; when absent the region closes at `baseline`. */
  samples2?: LearningPoint[];
  /** Baseline y-value the region closes against when `samples2` is absent (default 0). */
  baseline?: number;
  /** Fill/stroke color: a tone name, token or literal (default `series-1`, tinted). */
  color?: string;
  /** Fill opacity (default 0.2). */
  opacity?: number;
  /** Region label, centered inside the filled area. */
  label?: string;
}

/**
 * A single bar (riemann strip / histogram column) between two y-values at an x-span.
 * @synonyms riemann, histogram, bars
 */
export interface MathBar {
  /** Left edge, in world x. */
  x: number;
  /** Bar width, in world x units. */
  width: number;
  /** Bottom y-value (default 0). */
  y0?: number;
  /** Top y-value. */
  y1: number;
  /** Fill/stroke color: a tone name, token or literal (default `series-2`, tinted). */
  color?: string;
  /** Fill opacity (default 0.5). */
  opacity?: number;
}

/** A reference line spanning the plot, at a fixed x (vline) or y (hline). */
export interface MathGuide {
  /** 'vline' spans the plot vertically at world x = `at`; 'hline' spans horizontally at world y = `at`. */
  kind: 'vline' | 'hline';
  /** World coordinate the guide sits at. */
  at: number;
  /** Line color: a tone name, token or literal (default `guide`). */
  color?: string;
  /** Stroke dash style (default 'dashed'); 'solid' draws an unbroken line. */
  dash?: 'solid' | 'dashed' | 'dotted';
  /** Guide label, drawn near the plot edge. */
  label?: string;
}

/** An arc marking the angle swept between two directions at a vertex. */
export interface MathAngle {
  /** Vertex x, in world coordinates. */
  x: number;
  /** Vertex y, in world coordinates. */
  y: number;
  /** Sweep start, in degrees, math convention (CCW from +x). */
  from: number;
  /** Sweep end, in degrees, math convention (CCW from +x). */
  to: number;
  /** Arc radius, in world-x units (default 0.8). */
  radius?: number;
  /** Arc + label color: a tone name, token or literal (default `series-4`). */
  color?: string;
  /** Angle label. */
  label?: string;
}

/**
 * A jump arc between two points on the x-axis (number-line hop / interval jump).
 * @synonyms number line jump, hop arrow
 */
export interface MathHop {
  /** Start x, in world coordinates. */
  from: number;
  /** End x, in world coordinates. */
  to: number;
  /** Arc + arrowhead color: a tone name, token or literal (default `series-3`). */
  color?: string;
  /** Hop label, centered above the arc. */
  label?: string;
}

export interface MathCanvasProps extends Omit<React.AriaAttributes, keyof A11yProps>, A11yProps {
  className?: string;
  width?: number;
  height?: number;
  title?: string;
  xMin?: number;
  xMax?: number;
  yMin?: number;
  yMax?: number;
  showAxes?: boolean;
  showGrid?: boolean;
  gridStep?: number;
  /** Canvas ground: a tone name, `var()` token or literal. Default the theme's `--surface-diagram`. */
  backgroundColor?: string;
  /** Overrides the theme's categorical palette (`series-1…N`) for this canvas — real-world conventions like CPK atom colors or resistor bands. Unset, the theme's `--color-series-*` apply. */
  series?: string[];
  /** Grid line color: a tone name, token or literal (default the `grid` tone). */
  gridColor?: string;
  /** Axis line color: a tone name, token or literal (default the `axis` tone). */
  axisColor?: string;
  /**
   * How the x and y ranges map to the canvas. `fit` stretches each range to fill the plot (function
   * plots); `equal` uses one scale for both axes so circles stay round (geometry). Default `fit`.
   */
  aspect?: 'fit' | 'equal';
  /** Draw numeric labels on grid lines (default false). */
  showTickLabels?: boolean;
  /** Font size in px for axis tick labels (default the theme's `xs` step). */
  tickLabelFontSize?: number;
  /** Font size in px for all other canvas annotations (default the theme's diagram label size). */
  labelFontSize?: number;
  /** Canvas text font family. Accepts a known game-font key (e.g. "future-narrow") or a CSS font-family string. */
  fontFamily?: string;
  /** Draw each curve's `label` at its last in-range sample (default false). */
  showCurveLabels?: boolean;
  curves?: MathCurve[];
  points?: MathPoint[];
  vectors?: MathVector[];
  /** Filled areas under curves or between curve pairs. */
  regions?: MathRegion[];
  /** Riemann/histogram bar strips. */
  bars?: MathBar[];
  /** Fixed reference lines (vline/hline). */
  guides?: MathGuide[];
  /** Angle-sweep arcs at a vertex. */
  angles?: MathAngle[];
  /** Number-line jump arcs. */
  hops?: MathHop[];
  /** Extra declarative shapes in canvas pixel coordinates. */
  shapes?: LearningShape[];
  /**
   * Game-canvas drawables painted in math world coordinates (e.g. `draw-sprite`
   * for a character sprite on the graph). The canvas maps their `ScenePos` through
   * the same x/y world→pixel transform used for curves/points.
   */
  drawables?: DrawableNode[];
  /** Top-right status chips (the LearningCanvas vocabulary). */
  readouts?: LearningReadout[];
  /** Inset sparkline panels (the LearningCanvas vocabulary). */
  traces?: LearningTracePanel[];
  interactive?: boolean;
  animate?: boolean;
  onShapeClick?: (payload: { id?: string; type?: string; index: number }) => void;
  /** Maps a keydown `e.code` — optionally prefixed `Mod+` (⌘/Ctrl), `Shift+`, `Alt+` in that order — to the board's SEMANTIC event (device-agnostic input), emitted as `UI:{event}` — same contract as the game canvas keyMap; keystrokes inside inputs/textareas never route. */
  keyMap?: Record<string, EventKey>;
  /** Maps a keyup `e.code` — optionally prefixed `Mod+` (⌘/Ctrl), `Shift+`, `Alt+` in that order — to the board's SEMANTIC event, emitted as `UI:{event}`; keystrokes inside inputs/textareas never route. */
  keyUpMap?: Record<string, EventKey>;
  isLoading?: boolean;
  error?: UiError | null;
}


export const MathCanvas: React.FC<MathCanvasProps> = ({
  className,
  title,
  width,
  height,
  xMin,
  xMax,
  yMin,
  yMax,
  showAxes,
  showGrid,
  gridStep,
  backgroundColor,
  series,
  gridColor,
  axisColor,
  aspect,
  showTickLabels,
  tickLabelFontSize,
  labelFontSize,
  fontFamily,
  showCurveLabels,
  curves,
  points,
  vectors,
  regions,
  bars,
  guides,
  angles,
  hops,
  shapes,
  drawables,
  readouts,
  traces,
  interactive,
  animate,
  keyMap,
  keyUpMap,
  onShapeClick,
  isLoading,
  error,
  ...rest
}) => {
  const config = useMemo<PatternConfig<'math-canvas'>>(
    () => ({
      type: 'math-canvas',
      width,
      height,
      xMin,
      xMax,
      yMin,
      yMax,
      showAxes,
      showGrid,
      gridStep,
      backgroundColor,
      series,
      gridColor,
      axisColor,
      aspect,
      showTickLabels,
      tickLabelFontSize,
      labelFontSize,
      fontFamily,
      showCurveLabels,
      curves,
      points,
      vectors,
      regions,
      bars,
      guides,
      angles,
      hops,
      shapes,
      drawables,
      readouts,
      traces,
      interactive,
      animate,
      keyMap,
      keyUpMap,
    }),
    [width, height, xMin, xMax, yMin, yMax, showAxes, showGrid, gridStep, backgroundColor, series, gridColor, axisColor, aspect, showTickLabels, tickLabelFontSize, labelFontSize, fontFamily, showCurveLabels, curves, points, vectors, regions, bars, guides, angles, hops, shapes, drawables, readouts, traces, interactive, animate, keyMap, keyUpMap],
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
        <OrbitalSceneCanvas pattern="math-canvas" config={config} width={width ?? 600} height={height ?? 400} callbacks={callbacks} keyMap={keyMap} keyUpMap={keyUpMap} />
      </VStack>
    </Card>
  );
};
