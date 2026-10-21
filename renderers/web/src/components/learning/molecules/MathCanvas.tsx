'use client';

/**
 * MathCanvas
 *
 * A field-scoped learning molecule for mathematics. Renders a coordinate plane
 * with axes, grid, curves (sampled points), scatter points, and vectors on top
 * of the declarative `LearningCanvas` atom.
 *
 * @packageDocumentation
 */

import * as React from 'react';
import { useEffect, useMemo } from 'react';
import { perfEnd, perfStart } from '../../../lib/perf';
import { Card, Typography } from '../../../core';
import { VStack } from '../../../core';
import { resolveGameFontFamily } from '../../../lib/gameFonts';
import { LearningCanvas } from '../atoms/LearningCanvas';
import type { LearningShape, LearningPoint, LearningReadout, LearningTracePanel } from '../atoms/LearningCanvas';
import type { UiError } from '../../../core';
import type { DrawableNode } from '../../../lib/drawable/paintDispatch';
import type { Projector } from '../../../lib/drawable/contract';
import type { A11yProps, EventKey, ScenePos } from '@almadar/core';
import { domPassthrough } from '../../../core';

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

function formatTick(v: number): string {
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

/** World → canvas mapping of the plot box; one source for shapes and drawables. */
export function plotTransform(width: number, height: number, xMin: number, xMax: number, yMin: number, yMax: number, aspect: 'fit' | 'equal') {
  const margin = 24;
  const fitW = width - margin * 2;
  const fitH = height - margin * 2;
  const fitSx = fitW / (xMax - xMin);
  const fitSy = fitH / (yMax - yMin);
  const sx = aspect === 'equal' ? Math.min(fitSx, fitSy) : fitSx;
  const sy = aspect === 'equal' ? Math.min(fitSx, fitSy) : fitSy;
  const left = margin + (fitW - sx * (xMax - xMin)) / 2;
  const bottom = height - margin - (fitH - sy * (yMax - yMin)) / 2;
  return {
    sx,
    sy,
    left,
    right: left + sx * (xMax - xMin),
    top: bottom - sy * (yMax - yMin),
    bottom,
    plotH: sy * (yMax - yMin),
    mapX: (x: number) => left + (x - xMin) * sx,
    mapY: (y: number) => bottom - (y - yMin) * sy,
  };
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
  /** Top-right status chips, forwarded verbatim to LearningCanvas. */
  readouts?: LearningReadout[];
  /** Inset sparkline panels, forwarded verbatim to LearningCanvas. */
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
  width = 600,
  height = 400,
  title,
  xMin = -10,
  xMax = 10,
  yMin = -10,
  yMax = 10,
  showAxes = true,
  showGrid = true,
  gridStep = 1,
  backgroundColor,
  series,
  gridColor = 'grid',
  axisColor = 'axis',
  aspect = 'fit',
  showTickLabels = false,
  tickLabelFontSize,
  labelFontSize,
  fontFamily: fontFamilyProp,
  showCurveLabels = false,
  curves = [],
  points = [],
  vectors = [],
  regions = [],
  bars = [],
  guides = [],
  angles = [],
  hops = [],
  shapes = [],
  drawables,
  readouts,
  traces,
  interactive = false,
  animate = false,
  onShapeClick,
  keyMap,
  keyUpMap,
  isLoading,
  error,
  ...rest
}) => {
  const fontFamily = resolveGameFontFamily(fontFamilyProp);


  const derivedShapes: LearningShape[] = useMemo(() => {
    const _perfT = perfStart('mathcanvas:derive');
    const out: LearningShape[] = [];

    const { sx, sy, left, right, top, bottom, plotH, mapX, mapY } = plotTransform(width, height, xMin, xMax, yMin, yMax, aspect);
    const plotW = right - left;
    const xAxisY = Math.max(top, Math.min(bottom, mapY(0)));
    const yAxisX = Math.max(left, Math.min(right, mapX(0)));

    if (showGrid) {
      for (let x = Math.ceil(xMin / gridStep) * gridStep; x <= xMax; x += gridStep) {
        const px = mapX(x);
        out.push({ type: 'line', x1: px, y1: top, x2: px, y2: bottom, color: gridColor, stroke: 'thin' });
      }
      for (let y = Math.ceil(yMin / gridStep) * gridStep; y <= yMax; y += gridStep) {
        const py = mapY(y);
        out.push({ type: 'line', x1: left, y1: py, x2: right, y2: py, color: gridColor, stroke: 'thin' });
      }
    }

    if (showTickLabels) {
      const labelEveryX = Math.max(1, Math.ceil(((xMax - xMin) / gridStep) / Math.floor(plotW / 40)));
      let kx = 0;
      for (let x = Math.ceil(xMin / gridStep) * gridStep; x <= xMax; x += gridStep, kx++) {
        if (kx % labelEveryX === 0 && x !== 0) {
          out.push({ type: 'text', textCase: 'verbatim', fontFamily, x: mapX(x), y: xAxisY + 12, text: formatTick(x), tone: 'label', textSize: 'xs', fontSize: tickLabelFontSize, align: 'center' });
        }
      }
      const labelEveryY = Math.max(1, Math.ceil(((yMax - yMin) / gridStep) / Math.floor(plotH / 28)));
      let ky = 0;
      for (let y = Math.ceil(yMin / gridStep) * gridStep; y <= yMax; y += gridStep, ky++) {
        if (ky % labelEveryY === 0 && y !== 0) {
          out.push({ type: 'text', textCase: 'verbatim', fontFamily, x: yAxisX - 6, y: mapY(y), text: formatTick(y), tone: 'label', textSize: 'xs', fontSize: tickLabelFontSize, align: 'right' });
        }
      }
      if (xMin <= 0 && xMax >= 0 && yMin <= 0 && yMax >= 0) {
        out.push({ type: 'text', textCase: 'verbatim', fontFamily, x: yAxisX - 6, y: xAxisY + 12, text: '0', tone: 'label', textSize: 'xs', fontSize: tickLabelFontSize, align: 'right' });
      }
    }

    for (const region of regions) {
      if (!region.samples || region.samples.length === 0) continue;
      const baseline = region.baseline ?? 0;
      const clampedPoint = (p: LearningPoint) => ({
        x: mapX(Math.min(xMax, Math.max(xMin, p.x))),
        y: mapY(Math.min(yMax, Math.max(yMin, p.y))),
      });
      const upper = region.samples.map(clampedPoint);
      const first = region.samples[0];
      const last = region.samples[region.samples.length - 1];
      const closing =
        region.samples2 && region.samples2.length > 0
          ? [...region.samples2].reverse().map(clampedPoint)
          : [clampedPoint({ x: last.x, y: baseline }), clampedPoint({ x: first.x, y: baseline })];
      const color = region.color ?? 'series-1';
      out.push({
        type: 'polygon',
        points: [...upper, ...closing],
        fill: color,
        color,
        fillStyle: 'tint',
        opacity: region.opacity,
        stroke: 'thin',
      });
      if (region.label) {
        const mid = Math.floor(region.samples.length / 2);
        out.push({
          type: 'text', textCase: 'verbatim', fontFamily,
          x: mapX((first.x + last.x) / 2),
          y: (mapY(region.samples[mid].y) + mapY(baseline)) / 2,
          text: region.label,
          color,
          fontSize: labelFontSize,
        });
      }
    }

    for (const bar of bars) {
      if (bar.x + bar.width < xMin || bar.x > xMax) continue;
      const y0 = bar.y0 ?? 0;
      const color = bar.color ?? 'series-2';
      out.push({
        type: 'rect',
        x: mapX(bar.x),
        y: mapY(Math.max(y0, bar.y1)),
        width: mapX(bar.x + bar.width) - mapX(bar.x),
        height: Math.abs(mapY(bar.y1) - mapY(y0)),
        color,
        fill: color,
        fillStyle: 'tint',
        opacity: bar.opacity,
        stroke: 'thin',
      });
    }

    if (showAxes) {
      out.push({ type: 'line', x1: left, y1: xAxisY, x2: right, y2: xAxisY, color: axisColor, stroke: 'normal' });
      out.push({ type: 'line', x1: yAxisX, y1: top, x2: yAxisX, y2: bottom, color: axisColor, stroke: 'normal' });
    }

    for (const guide of guides) {
      const color = guide.color ?? 'guide';
      const dash = guide.dash ?? 'dashed';
      if (guide.kind === 'vline') {
        if (guide.at < xMin || guide.at > xMax) continue;
        const px = mapX(guide.at);
        out.push({ type: 'line', x1: px, y1: top, x2: px, y2: bottom, color, dash, stroke: 'thin' });
        if (guide.label) {
          out.push({ type: 'text', textCase: 'verbatim', fontFamily, x: px + 4, y: top + 10, text: guide.label, color, fontSize: labelFontSize });
        }
      } else {
        if (guide.at < yMin || guide.at > yMax) continue;
        const py = mapY(guide.at);
        out.push({ type: 'line', x1: left, y1: py, x2: right, y2: py, color, dash, stroke: 'thin' });
        if (guide.label) {
          out.push({ type: 'text', textCase: 'verbatim', fontFamily, x: right - 4, y: py - 8, text: guide.label, color, fontSize: labelFontSize, align: 'right' });
        }
      }
    }

    for (const [curveIndex, curve] of curves.entries()) {
      if (!curve.samples || curve.samples.length < 2) continue;
      const curveColor = curve.color ?? `series-${(curveIndex % 8) + 1}`;
      // One clipped Path2D per curve: segments are clipped to the x-window (y is
      // interpolated at the crossing) instead of dropped, so curves no longer snap
      // off at the viewport edge under a moving window; a single stroked path with
      // round joins also removes the seams dense per-segment lines used to show.
      let d = '';
      let penDown = false;
      let lastInRange: LearningPoint | undefined;
      for (let i = 1; i < curve.samples.length; i++) {
        const a = curve.samples[i - 1];
        const b = curve.samples[i];
        if ((a.x < xMin && b.x < xMin) || (a.x > xMax && b.x > xMax)) {
          penDown = false;
          continue;
        }
        const clip = (p: LearningPoint, q: LearningPoint, xLim: number): LearningPoint => {
          const t = q.x === p.x ? 0 : (xLim - p.x) / (q.x - p.x);
          return { x: xLim, y: p.y + t * (q.y - p.y) };
        };
        const ca = a.x < xMin ? clip(a, b, xMin) : a.x > xMax ? clip(a, b, xMax) : a;
        const cb = b.x < xMin ? clip(a, b, xMin) : b.x > xMax ? clip(a, b, xMax) : b;
        const pax = mapX(ca.x);
        const pay = mapY(ca.y);
        d += `${penDown ? 'L' : 'M'} ${pax} ${pay} L ${mapX(cb.x)} ${mapY(cb.y)} `;
        penDown = true;
        if (b.x >= xMin && b.x <= xMax) lastInRange = b;
      }
      if (!d) continue;
      out.push({
        type: 'path',
        path: d,
        color: curveColor,
        stroke: 'bold',
        dash: curve.dash,
      });
      if (showCurveLabels && curve.label && lastInRange) {
        out.push({
          type: 'text', textCase: 'verbatim', fontFamily,
          x: mapX(lastInRange.x) + 6,
          y: mapY(lastInRange.y) - 6,
          text: curve.label,
          color: curveColor,
          fontSize: labelFontSize,
        });
      }
    }

    for (const hop of hops) {
      const x1 = mapX(hop.from);
      const x2 = mapX(hop.to);
      const peak = Math.min(36, plotH * 0.3);
      const color = hop.color ?? 'series-3';
      out.push({
        type: 'ellipse',
        x: (x1 + x2) / 2,
        y: xAxisY,
        width: Math.abs(x2 - x1),
        height: 2 * peak,
        startAngle: 180,
        endAngle: 360,
        color,
      });
      const s = Math.sign(hop.to - hop.from);
      out.push({
        type: 'polygon',
        points: [
          { x: x2, y: xAxisY },
          { x: x2 - 4 * s, y: xAxisY - 7 },
          { x: x2 + 2 * s, y: xAxisY - 7 },
        ],
        fill: color,
        color,
      });
      if (hop.label) {
        out.push({
          type: 'text', textCase: 'verbatim', fontFamily,
          x: (x1 + x2) / 2,
          y: xAxisY - peak - 8,
          text: hop.label,
          color,
          fontSize: labelFontSize,
          align: 'center',
        });
      }
    }

    for (const angle of angles) {
      const radius = angle.radius ?? 0.8;
      const color = angle.color ?? 'series-4';
      out.push({
        type: 'ellipse',
        x: mapX(angle.x),
        y: mapY(angle.y),
        width: 2 * radius * sx,
        height: 2 * radius * sy,
        startAngle: -angle.to,
        endAngle: -angle.from,
        color,
      });
      if (angle.label) {
        const mid = (angle.from + angle.to) / 2;
        const rad = (mid * Math.PI) / 180;
        out.push({
          type: 'text', textCase: 'verbatim', fontFamily,
          x: mapX(angle.x + 1.35 * radius * Math.cos(rad)),
          y: mapY(angle.y + 1.35 * radius * Math.sin(rad)),
          text: angle.label,
          color,
          fontSize: labelFontSize,
          align: 'center',
        });
      }
    }

    for (const p of points) {
      if (p.x < xMin || p.x > xMax || p.y < yMin || p.y > yMax) continue;
      const isOpen = p.style === 'open';
      out.push({
        type: 'circle',
        x: mapX(p.x),
        y: mapY(p.y),
        radius: p.radius ?? 4,
        color: p.color ?? 'highlight',
        fill: p.color ?? 'highlight',
        fillStyle: isOpen ? 'outline' : 'solid',
        stroke: 'normal',
      });
      if (p.label) {
        out.push({ type: 'text', textCase: 'verbatim', fontFamily, x: mapX(p.x) + 8, y: mapY(p.y) - 8, text: p.label, tone: 'ink', fontSize: labelFontSize });
      }
    }

    for (const v of vectors) {
      if (v.x < xMin || v.x > xMax || v.y < yMin || v.y > yMax) continue;
      const x1 = mapX(v.x);
      const y1 = mapY(v.y);
      const x2 = mapX(v.x + v.vx);
      const y2 = mapY(v.y + v.vy);
      out.push({ type: 'arrow', x1, y1, x2, y2, color: v.color ?? 'series-5', stroke: 'bold' });
      if (v.label) {
        out.push({ type: 'text', textCase: 'verbatim', fontFamily, x: x2 + 6, y: y2 - 6, text: v.label, color: v.color ?? 'series-5', fontSize: labelFontSize });
      }
    }

    out.push(...shapes);
    perfEnd('mathcanvas:derive', _perfT);
    return out;
  }, [
    width,
    height,
    xMin,
    xMax,
    yMin,
    yMax,
    showAxes,
    showGrid,
    gridStep,
    aspect,
    gridColor,
    axisColor,
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
  ]);

  // Projector for game drawables: one world-x unit maps to `xScale` pixels; the
  // y-axis may have a different scale, but sprites size by xScale so they keep
  // square pixels and consistent aspect regardless of uneven axes.
  const projector: Projector | undefined = useMemo(() => {
    if (!drawables?.length) return undefined;
    const { sx: xScale, mapX, mapY } = plotTransform(width, height, xMin, xMax, yMin, yMax, aspect);
    const project = (pos: ScenePos) => ({ x: mapX(pos.x), y: mapY(pos.y) });
    const anchorPoint = (pos: ScenePos, anchor: 'top-left' | 'ground' | 'center') => {
      const base = project(pos);
      if (anchor === 'top-left') return base;
      const cx = base.x + xScale / 2;
      if (anchor === 'ground') return { x: cx, y: base.y + xScale * 0.92 };
      return { x: cx, y: base.y + xScale / 2 };
    };
    const cellPath = (pos: ScenePos) => {
      const base = project(pos);
      return [
        { x: base.x, y: base.y },
        { x: base.x + xScale, y: base.y },
        { x: base.x + xScale, y: base.y + xScale },
        { x: base.x, y: base.y + xScale },
      ];
    };
    return {
      project,
      anchorPoint,
      cellPath,
      tileWidth: xScale,
      floorHeight: xScale / 2,
      diamondTopY: 0,
      squareGrid: true,
      worldPixelDirect: false,
    };
  }, [drawables?.length, width, height, xMin, xMax, yMin, yMax, aspect]);

  return (
    <Card {...domPassthrough(rest)} className={className}>
      <VStack gap="sm">
        {title ? <Typography variant="h4">{title}</Typography> : null}
        <LearningCanvas
          width={width}
          height={height}
          backgroundColor={backgroundColor}
          series={series}
          keyMap={keyMap}
          keyUpMap={keyUpMap}
          fontFamily={fontFamily}
          shapes={derivedShapes}
          drawables={drawables}
          projector={projector}
          readouts={readouts}
          traces={traces}
          interactive={interactive}
          animate={animate}
          onShapeClick={onShapeClick}
          isLoading={isLoading}
          error={error}
        />
      </VStack>
    </Card>
  );
};
