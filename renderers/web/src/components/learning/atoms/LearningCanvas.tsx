'use client';

/**
 * LearningCanvas
 *
 * A declarative canvas atom for math and science visualizations: a list of primitive shapes (line, arrow, circle,
 * rect, polygon, path, text, axis, grid) plus readout chips and trace insets, mapped and drawn by orbital-canvas.
 * Optional interactivity emits click events.
 *
 * This is the foundational atom for the `learning/` behavior family.
 *
 * @packageDocumentation
 */

import * as React from 'react';
import { useId, useMemo } from 'react';
import type { A11yProps, EventKey, GpuBuffer, PatternConfig } from '@almadar/core';
import { Box } from '../../../core';
import { domPassthrough } from '../../../core';
import { cn } from '../../../core';
import { useTranslate } from '../../../core';
import type { UiError } from '../../../core';
import type { DrawableNode } from '../../../lib/drawable/paintDispatch';
import type { Projector } from '../../../lib/drawable/contract';
import type { DiagramMarkRoles } from '@almadar/core';
import { Typography } from '../../../core';
import { OrbitalSceneCanvas } from '../../../lib/drawable/orbital/OrbitalSceneCanvas';
import { gpuBufferConfig, shapeClickPayload, type ShapeClickPayload } from '../../../lib/drawable/orbital/sceneConfig';

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

/**
 * Particles packed as data (a GPU readback, for one): one little-endian 32-bit word every `stride` bytes, x in bits
 * 0-11, y in bits 12-23 and a `palette` index in bits 24-31. Drawn in one pass, without a shape per particle.
 */
export interface LearningParticles {
  /** The packed words as base64 bytes (a CPU copy); exactly one of `data` or `buffer`. */
  data?: string;
  /** The packed words where they lie on the GPU (a program's compute output, drawn without a readback). */
  buffer?: GpuBuffer;
  /** Bytes from one particle's word to the next. */
  stride: number;
  /** Drawn half-size of each particle, in scene pixels. */
  radius: number;
  /** Particle colors by index: tone names, `var()` tokens or literals; an index past the end takes the last. */
  palette: string[];
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
  /** Packed particles drawn under the shapes in one pass ({@link LearningParticles}). */
  particles?: LearningParticles;
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

/** The packed particles as the plain JSON a scene config carries. */
export function particlesConfig(particles: LearningParticles | undefined) {
  return particles && { ...particles, palette: [...particles.palette], buffer: gpuBufferConfig(particles.buffer) };
}

/** The `callbacks` a learning scene routes for an `onShapeClick` function prop. */
export function shapeClickCallbacks(onShapeClick: ((payload: ShapeClickPayload) => void) | undefined) {
  if (!onShapeClick) return undefined;
  return {
    onShapeClick: (delivered: Parameters<typeof shapeClickPayload>[0]) => {
      const payload = shapeClickPayload(delivered);
      if (payload) onShapeClick(payload);
    },
  };
}

export interface LearningCanvasStateProps {
  className?: string;
  width: number;
  height: number;
  isLoading?: boolean;
  error?: UiError | null;
}

/** The loading or error placeholder a learning canvas shows in place of its drawing; `null` when neither. */
export function LearningCanvasState({ className, width, height, isLoading, error }: LearningCanvasStateProps): React.JSX.Element | null {
  const { t } = useTranslate();
  if (!isLoading && !error) return null;
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

export const LearningCanvas: React.FC<LearningCanvasProps> = ({
  className,
  width,
  height,
  backgroundColor,
  series,
  fontFamily,
  shapes,
  particles,
  drawables,
  readouts,
  traces,
  keyMap,
  keyUpMap,
  interactive,
  animate,
  onShapeClick,
  description,
  isLoading,
  error,
  ...rest
}) => {
  const descId = useId();
  const { t } = useTranslate();
  const config = useMemo<PatternConfig<'learning-canvas'>>(
    () => ({
      type: 'learning-canvas',
      width,
      height,
      backgroundColor,
      series,
      fontFamily,
      shapes,
      particles: particlesConfig(particles),
      drawables,
      readouts,
      traces,
      keyMap,
      keyUpMap,
      interactive,
      animate,
    }),
    [width, height, backgroundColor, series, fontFamily, shapes, particles, drawables, readouts, traces, keyMap, keyUpMap, interactive, animate],
  );
  const callbacks = useMemo(() => shapeClickCallbacks(onShapeClick), [onShapeClick]);

  if (isLoading || error) {
    return <LearningCanvasState className={className} width={width ?? 600} height={height ?? 400} isLoading={isLoading} error={error} />;
  }

  return (
    <>
      <Box
        className={cn('mx-auto block w-full', className)}
        role="img"
        aria-label={t('aria.learningCanvas')}
        aria-describedby={description ? descId : undefined}
        {...domPassthrough(rest)}
      >
        <OrbitalSceneCanvas pattern="learning-canvas" config={config} width={width ?? 600} height={height ?? 400} callbacks={callbacks} keyMap={keyMap} keyUpMap={keyUpMap} />
      </Box>
      {description ? <Box id={descId} className="sr-only">{description}</Box> : null}
    </>
  );
};
