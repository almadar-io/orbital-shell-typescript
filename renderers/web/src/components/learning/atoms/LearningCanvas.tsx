'use client';

/**
 * LearningCanvas
 *
 * A pure, declarative HTML5 canvas atom for math and science visualizations.
 * Accepts a list of primitive shapes (line, arrow, circle, rect, polygon, path,
 * text, axis, grid) and renders them. Optional interactivity emits click/hover
 * events, and optional animation drives a continuous render loop.
 *
 * This is the foundational atom for the `learning/` behavior family.
 *
 * @packageDocumentation
 */

import * as React from 'react';
import { useEffect, useId, useRef, useCallback, useMemo, useState } from 'react';
import type { A11yProps, EventKey } from '@almadar/core';
import { useKeyMapEvents } from '../../../hooks/useKeyMapEvents';
import { Box } from '../../../core';
import { domPassthrough } from '../../../core';
import { cn } from '../../../core';
import { perfEnd, perfStart } from '../../../lib/perf';
import { useEventBus } from '../../../core';
import { useTranslate } from '../../../core';
import type { UiError } from '../../../core';
import { createWebPainter } from '../../../lib/webPainter2d';
import { paintDrawable, type DrawableNode } from '../../../lib/drawable/paintDispatch';
import { resolveDrawableColors } from '../../../lib/drawable/themeDrawables';
import type { Projector } from '../../../lib/drawable/contract';
import { THEME_SERIES } from '../../../lib/theme-color';
import type { CanvasTheme, DiagramMarkRoles, DiagramStrokeWeight, DiagramTone } from '@almadar/core';
import {
  applyLineCharacter,
  arcPoints,
  drawMarker,
  fillMark,
  labelFont,
  labelText,
  fillLabel,
  outlineStroke,
  outlineCarriesFill,
  markColor,
  markDash,
  markStrokeWidth,
  tracePolyline,
} from '../../../lib/canvasTheme';
import { useCanvasTheme } from '../../../hooks/useCanvasTheme';
import { withSeries } from '../../../lib/canvasTheme';
import { useContainerWidth } from '../../../hooks/useContainerWidth';
import { Typography } from '../../../core';

export type LearningShapeType =
  | 'line'
  | 'arrow'
  | 'circle'
  | 'ellipse'
  | 'rect'
  | 'polygon'
  | 'path'
  | 'text'
  | 'axis'
  | 'grid'
  | 'venn-region';

export interface LearningPoint {
  x: number;
  y: number;
}

/**
 * A drawn mark. Style comes from the theme by role (`tone`, `stroke`, `text`, `font`,
 * `fillStyle`); a literal field on the same mark (`color`, `lineWidth`, `fontSize`) overrides its
 * role. `color` and `fill` also accept a tone name.
 */
export interface LearningShape extends DiagramMarkRoles {
  type: LearningShapeType;
  /** Optional stable id for interaction payloads. */
  id?: string;
  x?: number;
  y?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  radius?: number;
  width?: number;
  height?: number;
  points?: LearningPoint[];
  path?: string;
  text?: string;
  label?: string;
  fontSize?: number;
  /** Optional font family for this text shape; falls back to the canvas prop, then the theme body font. */
  fontFamily?: string;
  align?: 'left' | 'center' | 'right';
  axis?: 'x' | 'y';
  min?: number;
  max?: number;
  step?: number;
  /** Stroke/text color: a tone name (`ink`, `guide`, `series-2`, …), a `var()` token or a literal. Overrides `tone`. */
  color?: string;
  /** Fill color: a tone name, a `var()` token or a literal. A literal fills solid unless `fillStyle` says otherwise. */
  fill?: string;
  /** Stroke width in px. Overrides `stroke`. */
  lineWidth?: number;
  opacity?: number;
  /** Ellipse arc start, in degrees (screen convention: 0 = +x, clockwise). Omit with `endAngle` for a full ellipse. */
  startAngle?: number;
  /** Ellipse arc end, in degrees (screen convention: 0 = +x, clockwise). Omit with `startAngle` for a full ellipse. */
  endAngle?: number;
  /** Stroke dash style for line/arrow/circle/rect/polygon/path/ellipse strokes; omit or 'solid' for a solid line. */
  dash?: 'solid' | 'dashed' | 'dotted';
  /** venn-region only: ids of sibling `circle` shapes; the filled region is the INTERSECTION of these circles. */
  inside?: string[];
  /** venn-region only: ids of sibling `circle` shapes SUBTRACTED from the `inside` intersection (true lens/exclusion shading). */
  outside?: string[];
}

/** A single top-right status chip (e.g. a live measurement or score). */
export interface LearningReadout {
  /** Chip label, shown before the value. */
  label: string;
  /** Chip value, shown after the label. */
  value: string | number;
  /** Accent of the chip's marker dot: a tone name, token or literal (default `highlight`). */
  color?: string;
}

/** One plotted line within a trace panel. */
export interface LearningTraceSeries {
  /** Time-series samples in world/data coordinates. */
  samples: LearningPoint[];
  /** Series line + dot color (defaults from TRACE_SERIES_COLORS by index). */
  color?: string;
  /** Series label drawn top-left inside the panel. */
  label?: string;
}

/**
 * A minimal in-canvas sparkline inset — no ticks/grid/legend. For real axes, compose
 * a MathCanvas instead.
 */
export interface LearningTracePanel {
  /** Panel left edge (default anchors bottom-right, stacked upward per panel index). */
  x?: number;
  /** Panel top edge. */
  y?: number;
  /** Panel width (default 32% of canvas width). */
  width?: number;
  /** Panel height (default 28% of canvas height). */
  height?: number;
  /** Series drawn in this panel, auto-scaled to their combined extent. */
  series: LearningTraceSeries[];
  /** Bottom-right inside label, e.g. the x-axis quantity. */
  xLabel?: string;
  /** Top-right inside label, e.g. the y-axis quantity. */
  yLabel?: string;
  /** Panel border color (default `var(--color-border)`). */
  frameColor?: string;
  /** Panel fill color (default `var(--color-card)`). */
  backgroundColor?: string;
  /** Panel fill opacity (default 0.85). */
  backgroundOpacity?: number;
}

const DASH_PATTERNS = { solid: [], dashed: [6, 4], dotted: [2, 3] } as const;

export const TRACE_SERIES_COLORS = THEME_SERIES;

export interface LearningCanvasProps extends A11yProps {
  /** Additional CSS classes. */
  className?: string;
  /** Canvas width in CSS pixels. */
  width?: number;
  /** Canvas height in CSS pixels. */
  height?: number;
  /** Canvas ground: a tone name, `var()` token or literal (default the theme's `--surface-diagram`). */
  backgroundColor?: string;
  /**
   * Overrides the theme's categorical palette for this canvas: `series-1…N` resolve to these
   * colors instead. For real-world conventions (CPK atom colors, resistor bands); unset, the
   * theme's `--color-series-*` apply.
   */
  series?: string[];
  /** Canvas text font family. Falls back to the theme's --font-family-body. */
  fontFamily?: string;
  /** Declarative shapes to draw. */
  shapes?: LearningShape[];
  /**
   * Neutral game-canvas drawables (e.g. `draw-sprite`, `draw-fx-layer`) painted
   * in world coordinates via the supplied `projector`. This lets the learning
   * canvas reuse the game drawable vocabulary without reimplementing sprites/FX.
   */
  drawables?: DrawableNode[];
  /**
   * World-to-pixel projector for `drawables`. When absent, `drawables` are ignored.
   */
  projector?: Projector;
  /**
   * Top-right status chip row (live measurements, scores, counters).
   * @synonyms chips, stats, measurements
   */
  readouts?: LearningReadout[];
  /**
   * Inset sparkline panels stacked from the bottom-right corner.
   * @synonyms sparkline, time series, history plot
   */
  traces?: LearningTracePanel[];
  /** Maps a keydown `e.code` — optionally prefixed `Mod+` (⌘/Ctrl), `Shift+`, `Alt+` — to a SEMANTIC event emitted as `UI:{event}` (e.g. `{ Space: TOGGLE_RUN, ArrowRight: STEP, KeyR: RESET }`); keystrokes inside inputs never route. */
  keyMap?: Record<string, EventKey>;
  /** Maps a keyup `e.code` to a semantic event emitted as `UI:{event}`. */
  keyUpMap?: Record<string, EventKey>;
  /** Enable pointer interaction (click/hover). */
  interactive?: boolean;
  /** Enable continuous redraw loop. */
  animate?: boolean;
  /** Clicked shape payload: { id?, type?, index }. */
  onShapeClick?: (payload: { id?: string; type?: string; index: number }) => void;
  /**
   * Hovered shape payload: { id?, type?, index }.
   * @notification
   */
  onShapeHover?: (payload: { id?: string; type?: string; index: number }) => void;
  /** Text alternative for the canvas, rendered as visually hidden text and linked by aria-describedby. */
  description?: string;
  /** Loading state. */
  isLoading?: boolean;
  /** Error state. */
  error?: UiError | null;
}

function shapeBounds(shape: LearningShape): { x: number; y: number; w: number; h: number } | null {
  switch (shape.type) {
    case 'line':
    case 'arrow':
      if (shape.x1 == null || shape.y1 == null || shape.x2 == null || shape.y2 == null) return null;
      return {
        x: Math.min(shape.x1, shape.x2) - 6,
        y: Math.min(shape.y1, shape.y2) - 6,
        w: Math.abs(shape.x2 - shape.x1) + 12,
        h: Math.abs(shape.y2 - shape.y1) + 12,
      };
    case 'circle':
      if (shape.x == null || shape.y == null || shape.radius == null) return null;
      return {
        x: shape.x - shape.radius - 4,
        y: shape.y - shape.radius - 4,
        w: shape.radius * 2 + 8,
        h: shape.radius * 2 + 8,
      };
    case 'ellipse':
      if (shape.x == null || shape.y == null || shape.width == null || shape.height == null) return null;
      return {
        x: shape.x - shape.width / 2 - 4,
        y: shape.y - shape.height / 2 - 4,
        w: shape.width + 8,
        h: shape.height + 8,
      };
    case 'rect':
      if (shape.x == null || shape.y == null || shape.width == null || shape.height == null) return null;
      return { x: shape.x - 4, y: shape.y - 4, w: shape.width + 8, h: shape.height + 8 };
    case 'polygon':
      if (!shape.points || shape.points.length === 0) return null;
      {
        const xs = shape.points.map((p) => p.x);
        const ys = shape.points.map((p) => p.y);
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        return {
          x: minX - 4,
          y: minY - 4,
          w: Math.max(...xs) - minX + 8,
          h: Math.max(...ys) - minY + 8,
        };
      }
    case 'text':
      if (shape.x == null || shape.y == null) return null;
      return { x: shape.x - 4, y: shape.y - (shape.fontSize ?? 14) - 4, w: 120, h: (shape.fontSize ?? 14) + 8 };
    default:
      return null;
  }
}

const DEFAULT_TONE: Partial<Record<LearningShapeType, DiagramTone>> = {
  grid: 'grid',
  axis: 'axis',
  text: 'label',
};

const DEFAULT_STROKE: Partial<Record<LearningShapeType, DiagramStrokeWeight>> = {
  grid: 'thin',
};

/** True when `value` is a color the author wrote out, rather than a theme role. */
function isLiteralColor(value: string | undefined): boolean {
  return value !== undefined && value !== '' && !value.startsWith('var(') && !/^[a-z]+(-\d)?$/.test(value);
}

function strokeMark(ctx: CanvasRenderingContext2D, color: string, width: number): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function drawShape(
  ctx: CanvasRenderingContext2D,
  shape: LearningShape,
  width: number,
  height: number,
  allShapes: readonly LearningShape[],
  theme: CanvasTheme,
  fontFamily?: string,
) {
  const scope = ctx.canvas;
  ctx.save();
  ctx.globalAlpha = shape.opacity ?? 1;
  const fillValue = shape.fill ?? shape.fillTone;
  const fill = fillValue !== undefined ? markColor(theme, fillValue, scope, 'fill') : undefined;
  const fillStyle = shape.fillStyle ?? (isLiteralColor(shape.fill) ? 'solid' : theme.fillStyle);
  const stroke = outlineStroke(markColor(theme, shape.color ?? shape.tone, scope, DEFAULT_TONE[shape.type] ?? 'ink'), fill, fillStyle, fillValue);
  const declaredWidth = markStrokeWidth(theme, shape.lineWidth, shape.stroke, DEFAULT_STROKE[shape.type] ?? 'normal');
  const lineWidth = outlineCarriesFill(fill, fillStyle, fillValue) ? Math.max(declaredWidth, theme.strokes.bold) : declaredWidth;
  applyLineCharacter(ctx, theme, stroke);
  ctx.setLineDash([...markDash(theme, shape.dash)]);

  const closedMark = (points: { x: number; y: number }[]) => {
    tracePolyline(ctx, theme, points, true);
    if (fill) fillMark(ctx, theme, fill, fillStyle);
    strokeMark(ctx, stroke, lineWidth);
  };

  switch (shape.type) {
    case 'grid': {
      const step = shape.step ?? 40;
      ctx.beginPath();
      for (let x = 0; x <= width; x += step) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
      }
      for (let y = 0; y <= height; y += step) {
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
      }
      strokeMark(ctx, stroke, lineWidth);
      break;
    }
    case 'axis': {
      const horizontal = (shape.axis ?? 'x') === 'x';
      tracePolyline(ctx, theme, horizontal ? [{ x: 0, y: height / 2 }, { x: width, y: height / 2 }] : [{ x: width / 2, y: 0 }, { x: width / 2, y: height }], false);
      strokeMark(ctx, stroke, lineWidth);
      break;
    }
    case 'line':
    case 'arrow': {
      if (shape.x1 == null || shape.y1 == null || shape.x2 == null || shape.y2 == null) break;
      tracePolyline(ctx, theme, [{ x: shape.x1, y: shape.y1 }, { x: shape.x2, y: shape.y2 }], false);
      strokeMark(ctx, stroke, lineWidth);
      if (shape.type === 'arrow') drawMarker(ctx, theme, shape.x1, shape.y1, shape.x2, shape.y2, stroke, lineWidth);
      break;
    }
    case 'circle': {
      if (shape.x == null || shape.y == null || shape.radius == null) break;
      if (theme.roughness > 0) closedMark(arcPoints(shape.x, shape.y, shape.radius, shape.radius));
      else {
        ctx.beginPath();
        ctx.arc(shape.x, shape.y, shape.radius, 0, Math.PI * 2);
        if (fill) fillMark(ctx, theme, fill, fillStyle);
        strokeMark(ctx, stroke, lineWidth);
      }
      break;
    }
    case 'ellipse': {
      if (shape.x == null || shape.y == null || shape.width == null || shape.height == null) break;
      const start = ((shape.startAngle ?? 0) * Math.PI) / 180;
      const end = ((shape.endAngle ?? 360) * Math.PI) / 180;
      const whole = Math.abs(end - start) >= Math.PI * 2 - 1e-6;
      if (theme.roughness > 0) {
        tracePolyline(ctx, theme, arcPoints(shape.x, shape.y, shape.width / 2, shape.height / 2, start, end), whole);
      } else {
        ctx.beginPath();
        ctx.ellipse(shape.x, shape.y, shape.width / 2, shape.height / 2, 0, start, end);
      }
      if (fill) fillMark(ctx, theme, fill, fillStyle);
      strokeMark(ctx, stroke, lineWidth);
      break;
    }
    case 'rect': {
      if (shape.x == null || shape.y == null || shape.width == null || shape.height == null) break;
      if (theme.roughness > 0 || theme.corner <= 0 || typeof ctx.roundRect !== 'function') {
        closedMark([
          { x: shape.x, y: shape.y },
          { x: shape.x + shape.width, y: shape.y },
          { x: shape.x + shape.width, y: shape.y + shape.height },
          { x: shape.x, y: shape.y + shape.height },
        ]);
      } else {
        ctx.beginPath();
        ctx.roundRect(shape.x, shape.y, shape.width, shape.height, Math.min(theme.corner, shape.width / 2, shape.height / 2));
        if (fill) fillMark(ctx, theme, fill, fillStyle);
        strokeMark(ctx, stroke, lineWidth);
      }
      break;
    }
    case 'polygon': {
      if (!shape.points || shape.points.length < 2) break;
      closedMark(shape.points);
      break;
    }
    case 'path': {
      if (!shape.path || typeof Path2D === 'undefined') break;
      const p = new Path2D(shape.path);
      if (fill && fillStyle !== 'outline') {
        ctx.save();
        ctx.globalAlpha *= fillStyle === 'tint' ? theme.fillOpacity : 1;
        ctx.fillStyle = fill;
        ctx.fill(p);
        ctx.restore();
      }
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth;
      ctx.stroke(p);
      break;
    }
    case 'text': {
      if (shape.x == null || shape.y == null || !shape.text) break;
      ctx.shadowBlur = 0;
      ctx.fillStyle = stroke;
      ctx.font = labelFont(theme, shape, shape.fontSize, shape.fontFamily ?? fontFamily).font;
      ctx.textAlign = shape.align ?? 'left';
      ctx.textBaseline = 'middle';
      fillLabel(ctx, theme, labelText(theme, shape.text, shape.textCase), shape.x, shape.y);
      break;
    }
    case 'venn-region': {
      // True boolean circle-region fill: intersection of the `inside` circles
      // minus the union of the `outside` circles, composited via an offscreen
      // canvas (successive clips intersect; destination-out punches exactly,
      // even where outside circles overlap each other — an evenodd path
      // cannot express that).
      const resolveCircles = (ids?: string[]) =>
        (ids ?? []).flatMap((id) => {
          const c = allShapes.find((s) => s.type === 'circle' && s.id === id);
          return c && c.x != null && c.y != null && c.radius != null
            ? [{ x: c.x, y: c.y, radius: c.radius }]
            : [];
        });
      const inside = resolveCircles(shape.inside);
      if (inside.length === 0 || typeof Path2D === 'undefined') break;
      const outside = resolveCircles(shape.outside);
      const off = document.createElement('canvas');
      off.width = ctx.canvas.width;
      off.height = ctx.canvas.height;
      const octx = off.getContext('2d');
      if (!octx) break;
      octx.setTransform(ctx.getTransform());
      for (const c of inside) {
        const p = new Path2D();
        p.arc(c.x, c.y, c.radius, 0, Math.PI * 2);
        octx.clip(p);
      }
      octx.globalAlpha = fillStyle === 'tint' ? theme.fillOpacity * 2 : 1;
      octx.fillStyle = fill ?? stroke;
      octx.fillRect(0, 0, width, height);
      octx.globalCompositeOperation = 'destination-out';
      octx.globalAlpha = 1;
      for (const c of outside) {
        const p = new Path2D();
        p.arc(c.x, c.y, c.radius, 0, Math.PI * 2);
        octx.fill(p);
      }
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(off, 0, 0);
      ctx.restore();
      break;
    }
  }

  ctx.restore();
}

/**
 * Readouts as quiet theme chips along the top-right edge: a hairline card on the drawing ground with
 * the value in the label face, and the readout's accent as a small leading dot.
 */
export function readoutShapes(readouts: LearningReadout[], width: number, theme: CanvasTheme, fontFamily?: string): LearningShape[] {
  const out: LearningShape[] = [];
  const px = theme.text.xs;
  const chipH = Math.round(px * 1.9);
  const pad = Math.round(px * 0.75);
  const dot = Math.max(3, Math.round(px * 0.3));
  const gap = 6;
  const charW = px * 0.62;
  let rightEdge = width - 8;
  let rowY = 8;
  for (const readout of readouts) {
    const text = labelText(theme, `${readout.label} ${String(readout.value)}`, 'verbatim');
    const chipW = Math.max(40, Math.round(text.length * charW + pad * 2 + dot * 3));
    let chipX = rightEdge - chipW;
    if (chipX < 8) {
      rowY += chipH + 4;
      rightEdge = width - 8;
      chipX = rightEdge - chipW;
    }
    out.push({ type: 'rect', x: chipX, y: rowY, width: chipW, height: chipH, tone: 'grid', fill: theme.ground, fillStyle: 'solid', stroke: 'thin', opacity: 0.94 });
    out.push({ type: 'circle', x: chipX + pad + dot, y: rowY + chipH / 2, radius: dot, color: readout.color ?? 'highlight', fill: readout.color ?? 'highlight', fillStyle: 'solid', stroke: 'thin' });
    out.push({ type: 'text', x: chipX + pad + dot * 3, y: rowY + chipH / 2, text: `${readout.label} ${String(readout.value)}`, tone: 'ink', textCase: 'verbatim', textSize: 'xs', fontFamily });
    rightEdge = chipX - gap;
  }
  return out;
}

export function traceShapes(panel: LearningTracePanel, k: number, width: number, height: number, theme: CanvasTheme, fontFamily?: string): LearningShape[] {
  const w = panel.width ?? Math.round(width * 0.32);
  const h = panel.height ?? Math.round(height * 0.28);
  const x = panel.x ?? width - w - 8;
  const y = panel.y ?? height - h - 8 - k * (h + 8);

  const allSamples = panel.series.flatMap((series) => series.samples);
  let xLo = Math.min(...allSamples.map((p) => p.x));
  let xHi = Math.max(...allSamples.map((p) => p.x));
  let yLo = Math.min(...allSamples.map((p) => p.y));
  let yHi = Math.max(...allSamples.map((p) => p.y));
  if (xLo === xHi) {
    xLo -= 1;
    xHi += 1;
  }
  if (yLo === yHi) {
    yLo -= 1;
    yHi += 1;
  }

  const out: LearningShape[] = [];
  out.push({
    type: 'rect',
    x,
    y,
    width: w,
    height: h,
    color: panel.frameColor ?? 'grid',
    fill: panel.backgroundColor ?? theme.ground,
    fillStyle: 'solid',
    stroke: 'thin',
    opacity: panel.backgroundOpacity ?? 0.92,
  });

  const showLegend = panel.series.length > 1 || !panel.yLabel;
  panel.series.forEach((series, j) => {
    const color = series.color ?? `series-${(j % 8) + 1}`;
    const mapped = series.samples.map((p) => ({
      x: x + 4 + ((p.x - xLo) / (xHi - xLo)) * (w - 8),
      y: y + h - 4 - ((p.y - yLo) / (yHi - yLo)) * (h - 8),
    }));
    for (let i = 1; i < mapped.length; i++) {
      out.push({
        type: 'line',
        x1: mapped[i - 1].x,
        y1: mapped[i - 1].y,
        x2: mapped[i].x,
        y2: mapped[i].y,
        color,
        stroke: 'normal',
      });
    }
    if (mapped.length > 0) {
      const last = mapped[mapped.length - 1];
      out.push({ type: 'circle', x: last.x, y: last.y, radius: 2.5, color, fill: color, fillStyle: 'solid', stroke: 'thin' });
    }
    if (series.label && showLegend) {
      const ly = y + 10 + 13 * j;
      out.push({ type: 'line', id: `trace-swatch-${j}`, x1: x + 6, y1: ly, x2: x + 16, y2: ly, color, stroke: 'bold' });
      out.push({ type: 'text', x: x + 20, y: ly, text: series.label, tone: 'label', textCase: 'verbatim', textSize: 'xs', fontFamily });
    }
  });

  if (panel.yLabel) {
    out.push({ type: 'text', x: x + w - 6, y: y + 10, text: panel.yLabel, tone: 'label', textCase: 'verbatim', textSize: 'xs', align: 'right', fontFamily });
  }
  if (panel.xLabel) {
    out.push({ type: 'text', x: x + w - 6, y: y + h - 8, text: panel.xLabel, tone: 'label', textCase: 'verbatim', textSize: 'xs', align: 'right', fontFamily });
  }

  return out;
}

function drawableNeedsAnimation(nodes: DrawableNode[] | undefined): boolean {
  if (!nodes) return false;
  return nodes.some((node): boolean => {
    if (node.type === 'draw-sprite') return node.animation !== undefined;
    if (node.type === 'draw-fx-layer') return Array.isArray(node.items) && node.items.length > 0;
    if (node.type === 'draw-sprite-layer') return Array.isArray(node.items) && node.items.some((it) => it.animation !== undefined);
    if (node.type === 'draw-group') return Array.isArray(node.items) && drawableNeedsAnimation(node.items);
    return false;
  });
}

export const LearningCanvas: React.FC<LearningCanvasProps> = ({
  className,
  width = 600,
  height = 400,
  backgroundColor,
  series,
  fontFamily,
  shapes = [],
  drawables,
  projector,
  readouts,
  traces,
  keyMap,
  keyUpMap,
  interactive = false,
  animate = false,
  onShapeClick,
  onShapeHover,
  description,
  isLoading,
  error,
  ...rest
}) => {
  const descId = useId();
  useKeyMapEvents(keyMap, keyUpMap);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const eventBus = useEventBus();
  const { t } = useTranslate();
  const animRef = useRef<number>(0);
  const hoverIndexRef = useRef<number>(-1);
  const [drawVersion, setDrawVersion] = useState(0);
  const invalidateRef = useRef(() => setDrawVersion((v) => v + 1));
  const needsAnim = useMemo(() => drawableNeedsAnimation(drawables), [drawables]);

  const findShapeAt = useCallback((clientX: number, clientY: number): number => {
    const canvas = canvasRef.current;
    if (!canvas) return -1;
    const rect = canvas.getBoundingClientRect();
    // The canvas may be displayed smaller than its logical size on narrow screens.
    const x = (clientX - rect.left) * (rect.width > 0 ? width / rect.width : 1);
    const y = (clientY - rect.top) * (rect.height > 0 ? height / rect.height : 1);
    // Search in reverse so top-most shape wins.
    for (let i = shapes.length - 1; i >= 0; i--) {
      const b = shapeBounds(shapes[i]);
      if (b && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
        return i;
      }
    }
    return -1;
  }, [shapes, width, height]);

  const { theme: baseTheme, version: themeVersion } = useCanvasTheme(canvasRef);
  const seriesKey = series ? series.join('|') : '';
  const theme = useMemo(() => withSeries(baseTheme, series, canvasRef.current), [baseTheme, seriesKey]);
  const displayWidth = useContainerWidth(canvasRef);

  const derivedShapes = useMemo(() => {
    if (!theme || (!traces?.length && !readouts?.length)) return shapes;
    const traceOut = (traces ?? []).flatMap((panel, k) => traceShapes(panel, k, width, height, theme, fontFamily));
    const readoutOut = readouts?.length ? readoutShapes(readouts, width, theme, fontFamily) : [];
    return [...shapes, ...traceOut, ...readoutOut];
  }, [shapes, traces, readouts, width, height, fontFamily, theme]);

  const draw = useCallback(() => {
    const _perfT = perfStart('learningcanvas:paint');
    const canvas = canvasRef.current;
    if (!canvas || !theme) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Shapes live in a width×height scene; the canvas paints that scene at its displayed size.
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const scale = (displayWidth && displayWidth > 0 ? displayWidth : width) / width;
    canvas.width = Math.max(1, Math.floor(width * scale * dpr));
    canvas.height = Math.max(1, Math.floor(height * scale * dpr));
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = markColor(theme, backgroundColor, canvas, 'fill');
    if (!backgroundColor) ctx.fillStyle = theme.ground;
    ctx.fillRect(0, 0, width, height);

    // Text always renders in a final top pass so labels are never buried under paths/fills.
    for (const shape of derivedShapes) {
      if (shape.type !== 'text') drawShape(ctx, shape, width, height, derivedShapes, theme, fontFamily);
    }
    for (const shape of derivedShapes) {
      if (shape.type === 'text') drawShape(ctx, shape, width, height, derivedShapes, theme, fontFamily);
    }

    // Game drawables paint on top of the math world using the supplied projector.
    if (drawables?.length && projector) {
      const painter = createWebPainter(ctx, invalidateRef.current);
      const timeMs = needsAnim && theme.motion.enabled && typeof performance !== 'undefined' ? performance.now() : 0;
      const dctx = { projector, time: timeMs, invalidate: invalidateRef.current, fontFamily: fontFamily || theme.faces[theme.label.font] };
      for (const node of resolveDrawableColors(drawables, (c) => markColor(theme, c, canvas, 'ink'))) {
        paintDrawable(painter, node, dctx);
      }
    }

    perfEnd('learningcanvas:paint', _perfT);
  }, [width, height, backgroundColor, derivedShapes, drawables, projector, needsAnim, theme, themeVersion, displayWidth, fontFamily]);

  useEffect(() => {
    draw();
  }, [draw, drawVersion]);

  useEffect(() => {
    const shouldAnimate = (animate || needsAnim) && theme?.motion.enabled === true;
    if (!shouldAnimate) return;
    const loop = () => {
      draw();
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [animate, needsAnim, draw, theme]);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!interactive) return;
      const idx = findShapeAt(e.clientX, e.clientY);
      if (idx !== hoverIndexRef.current) {
        hoverIndexRef.current = idx;
        if (idx >= 0) {
          const shape = shapes[idx];
          const payload = { ...(shape.id !== undefined ? { id: shape.id } : {}), type: shape.type, index: idx };
          if (onShapeHover) onShapeHover(payload);
          else if (eventBus) eventBus.emit(`UI:SHAPE_HOVER`, payload);
        }
      }
    },
    [interactive, onShapeHover, eventBus, findShapeAt, shapes],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!interactive) return;
      const idx = findShapeAt(e.clientX, e.clientY);
      if (idx >= 0) {
        const shape = shapes[idx];
        const payload = { ...(shape.id !== undefined ? { id: shape.id } : {}), type: shape.type, index: idx };
        if (onShapeClick) onShapeClick(payload);
        else if (eventBus) eventBus.emit(`UI:SHAPE_CLICK`, payload);
      }
    },
    [interactive, onShapeClick, eventBus, findShapeAt, shapes],
  );

  if (isLoading || error) {
    return (
      <Box
        className={cn('flex w-full items-center justify-center rounded-container bg-[var(--surface-diagram)]', className)}
        style={{ aspectRatio: `${width} / ${height}` }}
      >
        <Typography variant="body2" color={error ? 'error' : 'muted'}>
          {error ? error.message : t('learningCanvas.loading')}
        </Typography>
      </Box>
    );
  }

  const canvas = (
    <canvas
      ref={canvasRef}
      className={cn('mx-auto block touch-none rounded-container', className)}
      style={{ width: '100%', maxWidth: `min(100%, calc(70vh * ${width} / ${height}))`, height: 'auto', aspectRatio: `${width} / ${height}` }}
      onClick={handleClick}
      onPointerMove={handlePointerMove}
      role="img"
      aria-label={t('aria.learningCanvas')}
      aria-describedby={description ? descId : undefined}
      {...domPassthrough(rest)}
    />
  );
  if (!description) return canvas;
  return (
    <>
      {canvas}
      <Box id={descId} className="sr-only">{description}</Box>
    </>
  );
};
