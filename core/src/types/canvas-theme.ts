/**
 * Canvas theme — the theme's drawing axes (`diagram`, `scene`, diagram colors, the canvas ground)
 * resolved to concrete values for surfaces that cannot evaluate CSS: canvas 2D, three.js and the
 * native painters. A mark names a role (`tone`, `stroke`, `text`, `font`); the surface asks the
 * resolved theme what that role looks like.
 */

import { z } from 'zod';
import type { DiagramFillStyle, DiagramLabelFont, DiagramLineCap, DiagramLineJoin, DiagramMarker } from './domain.js';

/** The color roles a mark can name instead of a literal color. */
export type DiagramTone =
  | 'ink'
  | 'label'
  | 'guide'
  | 'axis'
  | 'grid'
  | 'highlight'
  | 'fill'
  | 'series-1'
  | 'series-2'
  | 'series-3'
  | 'series-4'
  | 'series-5'
  | 'series-6'
  | 'series-7'
  | 'series-8'
  | 'primary'
  | 'accent'
  | 'success'
  | 'warning'
  | 'error'
  | 'info'
  | 'muted';

export const DIAGRAM_TONES = [
  'ink', 'label', 'guide', 'axis', 'grid', 'highlight', 'fill',
  'series-1', 'series-2', 'series-3', 'series-4', 'series-5', 'series-6', 'series-7', 'series-8',
  'primary', 'accent', 'success', 'warning', 'error', 'info', 'muted',
] as const satisfies readonly DiagramTone[];
export const DiagramToneSchema = z.enum(DIAGRAM_TONES);

/** The theme color key (`--color-<key>`) each tone draws with. */
export const DIAGRAM_TONE_COLOR_KEYS: Readonly<Record<DiagramTone, string>> = {
  ink: 'diagram-ink',
  label: 'diagram-label',
  guide: 'diagram-guide',
  axis: 'diagram-axis',
  grid: 'diagram-grid',
  highlight: 'diagram-highlight',
  fill: 'diagram-fill',
  'series-1': 'series-1',
  'series-2': 'series-2',
  'series-3': 'series-3',
  'series-4': 'series-4',
  'series-5': 'series-5',
  'series-6': 'series-6',
  'series-7': 'series-7',
  'series-8': 'series-8',
  primary: 'primary',
  accent: 'accent',
  success: 'success',
  warning: 'warning',
  error: 'error',
  info: 'info',
  muted: 'muted-foreground',
};

export type DiagramStrokeWeight = 'thin' | 'normal' | 'bold';
export const DIAGRAM_STROKE_WEIGHTS = ['thin', 'normal', 'bold'] as const satisfies readonly DiagramStrokeWeight[];
export const DiagramStrokeWeightSchema = z.enum(DIAGRAM_STROKE_WEIGHTS);

export type DiagramTextSize = 'xs' | 'sm' | 'base' | 'lg' | 'xl' | '2xl';
export const DIAGRAM_TEXT_SIZES = ['xs', 'sm', 'base', 'lg', 'xl', '2xl'] as const satisfies readonly DiagramTextSize[];
export const DiagramTextSizeSchema = z.enum(DIAGRAM_TEXT_SIZES);

/** Whether a label follows the theme's label case or keeps its letters (symbols, units, formulas). */
export type DiagramTextCase = 'theme' | 'verbatim';
export const DIAGRAM_TEXT_CASES = ['theme', 'verbatim'] as const satisfies readonly DiagramTextCase[];
export const DiagramTextCaseSchema = z.enum(DIAGRAM_TEXT_CASES);

/** Each list names every member of its union (a missing member fails to compile). */
type Covers<U, L extends readonly U[]> = Exclude<U, L[number]> extends never ? true : false;
const _tonesComplete: Covers<DiagramTone, typeof DIAGRAM_TONES> = true;
const _strokesComplete: Covers<DiagramStrokeWeight, typeof DIAGRAM_STROKE_WEIGHTS> = true;
const _textComplete: Covers<DiagramTextSize, typeof DIAGRAM_TEXT_SIZES> = true;
const _caseComplete: Covers<DiagramTextCase, typeof DIAGRAM_TEXT_CASES> = true;
void _tonesComplete;
void _strokesComplete;
void _textComplete;
void _caseComplete;

/**
 * The roles a drawn mark can carry. A role overrides the theme default for that mark; a literal
 * style field on the same mark (`color`, `lineWidth`, `fontSize`) overrides the role.
 */
export interface DiagramMarkRoles {
  /** Stroke / text color role. */
  tone?: DiagramTone;
  /** Fill color role (default: the stroke's tone under the theme's fill style). */
  fillTone?: DiagramTone;
  /** Stroke weight role. */
  stroke?: DiagramStrokeWeight;
  /** Label size role — a step of the theme's type scale. */
  textSize?: DiagramTextSize;
  /** Label face role. */
  font?: DiagramLabelFont;
  /** `verbatim` keeps a symbol's letters (mg, pH, Na, θ) under an uppercase label theme; default `theme`. */
  textCase?: DiagramTextCase;
  /** Fill treatment; absent = the theme's `--diagram-fill-style`. */
  fillStyle?: DiagramFillStyle;
}

/** A theme shadow recipe reduced to what a canvas context can draw. */
export interface CanvasShadow {
  offsetX: number;
  offsetY: number;
  blur: number;
  color: string;
}

/** The theme's drawing axes resolved for one scope. Colors are canvas-ready CSS strings. */
export interface CanvasTheme {
  ground: string;
  /**
   * Diagram chrome surfaces: the neutral wash (`--color-muted`), cards (`--color-card`) and text
   * drawn on a primary fill (`--color-primary-foreground`).
   */
  surfaces: Readonly<Record<'muted' | 'card' | 'onPrimary', string>>;
  tones: Readonly<Record<DiagramTone, string>>;
  series: readonly string[];
  strokes: Readonly<Record<DiagramStrokeWeight, number>>;
  lineCap: DiagramLineCap;
  lineJoin: DiagramLineJoin;
  dash: readonly number[];
  dot: readonly number[];
  fillStyle: DiagramFillStyle;
  fillOpacity: number;
  roughness: number;
  glow: number;
  shadow: CanvasShadow | null;
  marker: DiagramMarker;
  faces: Readonly<Record<DiagramLabelFont, string>>;
  label: {
    font: DiagramLabelFont;
    size: DiagramTextSize;
    weight: string;
    uppercase: boolean;
  };
  /** Type scale in px. */
  text: Readonly<Record<DiagramTextSize, number>>;
  corner: number;
  motion: {
    enabled: boolean;
    fastMs: number;
    normalMs: number;
    slowMs: number;
    easing: string;
  };
  scene: {
    roughness: number;
    metalness: number;
    flat: boolean;
    outline: number;
    ambient: number;
    key: number;
    keyColor: string;
    fog: number;
  };
}
