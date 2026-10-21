'use client';

/**
 * PhysicsCanvas
 *
 * A field-scoped learning molecule for physics. Renders bodies, constraints,
 * velocity arrows, and force arrows on top of the declarative `LearningCanvas`
 * atom.
 *
 * @packageDocumentation
 */

import * as React from 'react';
import { useMemo, useRef } from 'react';
import { createLogger } from '@almadar/logger';
import type { A11yProps, Camera, DiagramTone, EventKey } from '@almadar/core';
import { domPassthrough } from '../../../core';
import { Box, Card, Typography } from '../../../core';
import { VStack } from '../../../core';
import { LearningCanvas } from '../atoms/LearningCanvas';
import type { LearningReadout, LearningShape, LearningTracePanel } from '../atoms/LearningCanvas';
import type { UiError } from '../../../core';
import type { DrawableNode } from '../../../lib/drawable/paintDispatch';
import type { CanvasLighting, CanvasPost } from '../../../lib/drawable/three/Canvas3DHost';
import {
  LearningScene3D,
  arrowBetween,
  arrowField,
  billboardLabel,
  cylinderBetween,
  get3DClickPayload,
  heightFieldMesh,
  meshSphere,
  polylineTube,
  type Learning3DPoint,
} from './learningScene3D';

const physicsLog = createLogger('almadar:ui:physics-canvas');

export interface LearningPhysicsBody {
  id?: string;
  x: number;
  y: number;
  /** 3D mode only: height in scene cells (2D ignores it). */
  z?: number;
  radius?: number;
  /** Body color: a tone name, token or literal (default the `series-1`..`series-8` tone by body index). */
  color?: string;
  label?: string;
  vx?: number;
  vy?: number;
  /** 3D mode only: velocity height component (2D ignores it). */
  vz?: number;
  fx?: number;
  fy?: number;
  /** 3D mode only: force height component (2D ignores it). */
  fz?: number;
}

export interface LearningPhysicsConstraint {
  from: string;
  to: string;
  /** Constraint color: a tone name, token or literal (default the `ink` tone). */
  color?: string;
  /** Draw style: rigid line (default), zigzag coil, or dashed tether. 2D only — 3D always draws a rod. */
  kind?: 'rod' | 'spring' | 'string';
}

/** Fixed scene fixture kind: ground/wall/ramp/box/pivot. */
export type PhysicsSceneObjectKind = 'ground' | 'wall' | 'ramp' | 'box' | 'pivot';

/**
 * A static, non-body scene fixture with a hatching pattern and an optional label.
 * @synonyms ground, wall, ramp, incline, pivot, floor
 */
export interface PhysicsSceneObject {
  /** Fixture kind; each kind reads its own subset of the point/span fields below. */
  kind: PhysicsSceneObjectKind;
  /** Point kinds: wall x, pivot x, box origin x. */
  x?: number;
  /** Point kinds: ground y, pivot y, box origin y. */
  y?: number;
  /** Span/ramp endpoint 1 x. */
  x1?: number;
  /** Span/ramp endpoint 1 y. */
  y1?: number;
  /** Span/ramp endpoint 2 x. */
  x2?: number;
  /** Span/ramp endpoint 2 y. */
  y2?: number;
  /** Box width. */
  width?: number;
  /** Box height. */
  height?: number;
  /** Stroke + hatch color: a tone name, token or literal (default the `ink` tone). */
  color?: string;
  /** Fill color: a tone name, token or literal; ramp defaults to the `fill` tone. */
  fill?: string;
  /** Fixture label. */
  label?: string;
}

/**
 * A named, labeled arrow anchored to a fixed point or to a body's live position.
 * @synonyms force arrow, labeled arrow, free body diagram
 */
export interface PhysicsVector {
  /** Anchor x; ignored when `body` resolves to a body. */
  x?: number;
  /** Anchor y; ignored when `body` resolves to a body. */
  y?: number;
  /** Anchor at this body's position, overriding `x`/`y`. */
  body?: string;
  /** Arrow x-component in pixels, before `scale`. */
  dx: number;
  /** Arrow y-component in pixels, before `scale`. */
  dy: number;
  /** Multiplies `dx`/`dy` (default 1). */
  scale?: number;
  /** Arrow + label color: a tone name, token or literal (default the `series-5` tone). */
  color?: string;
  /** Label drawn at the tip, offset 8px further along the arrow direction. */
  label?: string;
  /** Stroke dash style (default solid). */
  dash?: 'dashed' | 'dotted';
}

/** A trail point in canvas pixel coordinates. */
export interface PhysicsTrailPoint {
  x: number;
  y: number;
  /** 3D mode only; 2D ignores it. */
  z?: number;
}

/**
 * A fading trajectory polyline through recent body positions.
 * @synonyms trajectory, path, trace, orbit, orbit path, trajectory tube
 */
export interface PhysicsTrail {
  /** Authoring handle only — not clickable. */
  id?: string;
  points: PhysicsTrailPoint[];
  /** Line color: a tone name, token or literal (default the `guide` tone). */
  color?: string;
  /** 2D: stroke width in pixels (default the theme's normal stroke). 3D: tube radius in scene cells (default 0.05). */
  width?: number;
  /** Multiplies the per-segment fade opacity (default 1). */
  opacity?: number;
  /** Older segments fade toward transparent (default true). 2D only — 3D always draws an opaque tube. */
  fade?: boolean;
}

/** One elevation color band for a `surface3d` height field; sorted ascending by `min`. */
export interface PhysicsSurfaceBand {
  /** Inclusive floor height in cells; omit for the catch-all lowest band. */
  min?: number;
  color: string;
}

/**
 * A 3D height-field mesh (a wave, a terrain, a potential surface) rendered
 * from a row-major grid of heights. 3D only.
 * @synonyms heightfield, wave surface, terrain, potential surface
 */
export interface PhysicsSurface3D {
  /** Grid columns. */
  nx: number;
  /** Grid rows. */
  ny: number;
  /** Vertex heights, length `nx*ny`, row-major: `heights[iy*nx+ix]`. */
  heights: number[];
  /** Cell spacing in scene cells (default 1). */
  spacing?: number;
  /** Sheet center x on the ground plane (default 0). */
  x?: number;
  /** Sheet center y on the ground plane (default 0). */
  y?: number;
  /** Elevation color bands; omitted → a single flat-colored sheet. */
  bands?: PhysicsSurfaceBand[];
  /** Fallback color when `bands` is omitted: a tone name, token or literal (default the `series-1` tone). */
  color?: string;
  opacity?: number;
  /** Faceted low-poly shading (default true). */
  flatShading?: boolean;
}

/**
 * A single labeled 3D arrow (field arrow, axis-triad leg, force/velocity
 * vector), rendered via `vectors3d` + `vectorScale`. 3D only.
 * @synonyms 3D arrows, field arrows, axis triad
 */
export interface PhysicsVector3D {
  /** Clickable when present. */
  id?: string;
  /** Tail position, cells. */
  x: number;
  y: number;
  /** Tail height (default 0). */
  z?: number;
  /** Vector components, cells, before `vectorScale`. */
  dx: number;
  dy: number;
  /** Height component (default 0). */
  dz?: number;
  /** Arrow + label color: a tone name, token or literal (default the `series-5` tone). */
  color?: string;
  /** Billboard label at the tip. */
  label?: string;
  /** Shaft radius in scene cells (default 0.05). */
  width?: number;
}

/**
 * A screen-convention angle arc between two bearings, with a label past the arc.
 * @synonyms angle arc, theta, incline angle
 */
export interface PhysicsAngleMarker {
  x: number;
  y: number;
  /** Start bearing, degrees, screen convention (0 = +x, clockwise). */
  from: number;
  /** End bearing, degrees, screen convention (0 = +x, clockwise). */
  to: number;
  /** Arc radius in pixels (default 26). */
  radius?: number;
  /** Arc + label color: a tone name, token or literal (default the `series-4` tone). */
  color?: string;
  /** Label drawn past the arc, along the bisecting bearing. */
  label?: string;
}

/**
 * A single uniform vector/into-page/out-of-page lattice drawn over a region.
 * @synonyms magnetic field, into page, out of page, field grid
 */
export interface PhysicsField {
  kind: 'arrows' | 'into' | 'out';
  /** Lattice cell size in pixels (default 48). */
  spacing?: number;
  /** Arrow bearing in degrees, screen convention; `arrows` kind only (default 0). */
  angle?: number;
  /** Glyph size in pixels (default 14). */
  size?: number;
  /** Glyph color: a tone name, token or literal (default the `guide` tone). */
  color?: string;
  /** Region left edge (default 0). */
  x?: number;
  /** Region top edge (default 0). */
  y?: number;
  /** Region width (default canvas width). */
  width?: number;
  /** Region height (default canvas height). */
  height?: number;
}

/**
 * A bottom-left labeled bar gauge for a scalar quantity (energy, speed, charge, ...).
 * @synonyms energy bar, KE, PE, gauge
 */
export interface PhysicsMeter {
  label: string;
  value: number;
  /** Full-bar value (default: the max value across all meters, so bars stay comparable). */
  max?: number;
  /** Bar color: a tone name, token or literal (default the `series-1`..`series-8` tone by meter index). */
  color?: string;
}

const SERIES_TONES: readonly DiagramTone[] = ['series-1', 'series-2', 'series-3', 'series-4', 'series-5', 'series-6', 'series-7', 'series-8'];

function seriesTone(i: number): DiagramTone {
  return SERIES_TONES[i % SERIES_TONES.length];
}

function formatMeterValue(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(2)));
}

function sceneObjectShapes(obj: PhysicsSceneObject, canvasWidth: number, canvasHeight: number): LearningShape[] {
  const out: LearningShape[] = [];
  const color = obj.color ?? 'ink';
  switch (obj.kind) {
    case 'ground': {
      const xStart = obj.x1 ?? 0;
      const xEnd = obj.x2 ?? canvasWidth;
      const y = obj.y ?? 0;
      out.push({ type: 'line', x1: xStart, y1: y, x2: xEnd, y2: y, color, stroke: 'normal' });
      for (let hx = xStart + 7; hx <= xEnd; hx += 14) {
        out.push({ type: 'line', x1: hx, y1: y, x2: hx - 7, y2: y + 7, color, stroke: 'thin' });
      }
      if (obj.label) {
        out.push({
          type: 'text',
          x: (xStart + xEnd) / 2,
          y: y - 10,
          text: obj.label,
          tone: 'label',
          textSize: 'sm',
          align: 'center',
        });
      }
      break;
    }
    case 'wall': {
      const yStart = obj.y1 ?? 0;
      const yEnd = obj.y2 ?? canvasHeight;
      const x = obj.x ?? 0;
      out.push({ type: 'line', x1: x, y1: yStart, x2: x, y2: yEnd, color, stroke: 'normal' });
      for (let hy = yStart + 7; hy <= yEnd; hy += 14) {
        out.push({ type: 'line', x1: x, y1: hy, x2: x - 7, y2: hy + 7, color, stroke: 'thin' });
      }
      if (obj.label) {
        out.push({
          type: 'text',
          x: x + 12,
          y: (yStart + yEnd) / 2,
          text: obj.label,
          tone: 'label',
          textSize: 'sm',
          align: 'left',
        });
      }
      break;
    }
    case 'ramp': {
      const x1 = obj.x1 ?? 0;
      const y1 = obj.y1 ?? 0;
      const x2 = obj.x2 ?? canvasWidth;
      const y2 = obj.y2 ?? canvasHeight;
      out.push({
        type: 'polygon',
        points: [
          { x: x1, y: y1 },
          { x: x2, y: y2 },
          { x: x1, y: y2 },
        ],
        color,
        fill: obj.fill ?? 'fill',
        stroke: 'normal',
      });
      if (obj.label) {
        out.push({
          type: 'text',
          x: (2 * x1 + x2) / 3,
          y: (y1 + 2 * y2) / 3,
          text: obj.label,
          tone: 'label',
          textSize: 'sm',
          align: 'center',
        });
      }
      break;
    }
    case 'box': {
      const x = obj.x ?? 0;
      const y = obj.y ?? 0;
      const w = obj.width ?? 40;
      const h = obj.height ?? 40;
      out.push({ type: 'rect', x, y, width: w, height: h, color, fill: obj.fill, stroke: 'normal' });
      if (obj.label) {
        out.push({
          type: 'text',
          x: x + w / 2,
          y: y + h / 2,
          text: obj.label,
          tone: 'label',
          textSize: 'sm',
          align: 'center',
        });
      }
      break;
    }
    case 'pivot': {
      const x = obj.x ?? 0;
      const y = obj.y ?? 0;
      out.push({ type: 'circle', x, y, radius: 5, color, fill: color, fillStyle: 'solid' });
      out.push({ type: 'line', x1: x - 14, y1: y - 8, x2: x + 14, y2: y - 8, color, stroke: 'thin' });
      for (let k = 0; k < 5; k++) {
        const hx = x - 14 + 7 * k;
        out.push({ type: 'line', x1: hx, y1: y - 8, x2: hx - 6, y2: y - 14, color, stroke: 'thin' });
      }
      if (obj.label) {
        out.push({
          type: 'text',
          x,
          y: y - 30,
          text: obj.label,
          tone: 'label',
          textSize: 'sm',
          align: 'center',
        });
      }
      break;
    }
  }
  return out;
}

function trailShapes(trail: PhysicsTrail): LearningShape[] {
  const n = trail.points.length;
  if (n < 2) return [];
  const color = trail.color ?? 'guide';
  const fade = trail.fade ?? true;
  const globalOpacity = trail.opacity ?? 1;
  const out: LearningShape[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = trail.points[i];
    const b = trail.points[i + 1];
    const segmentOpacity = fade ? 0.12 + (0.68 * i) / (n - 1) : 0.6;
    out.push({
      type: 'line',
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      color,
      lineWidth: trail.width,
      stroke: 'normal',
      opacity: segmentOpacity * globalOpacity,
    });
  }
  return out;
}

/** rod = exact current line push. string = the same line, dashed. spring = zigzag coil between shortened, lead-in endpoints. */
function constraintShapes(
  c: LearningPhysicsConstraint,
  a: LearningPhysicsBody,
  b: LearningPhysicsBody,
): LearningShape[] {
  const color = c.color ?? 'ink';
  const kind = c.kind ?? 'rod';
  if (kind === 'rod') {
    return [{ type: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y, color, stroke: 'normal' }];
  }
  if (kind === 'string') {
    return [{ type: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y, color, stroke: 'normal', dash: 'dashed' }];
  }

  const COILS = 8;
  const AMP = 7;
  const LEAD = 10;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.max(1e-6, Math.hypot(dx, dy));
  const ux = dx / dist;
  const uy = dy / dist;
  const perpX = -uy;
  const perpY = ux;
  const aPrime = { x: a.x + LEAD * ux, y: a.y + LEAD * uy };
  const bPrime = { x: b.x - LEAD * ux, y: b.y - LEAD * uy };
  const m = 2 * COILS;

  const polyline: { x: number; y: number }[] = [{ x: a.x, y: a.y }, aPrime];
  for (let j = 1; j <= m; j++) {
    const t = j / (m + 1);
    const baseX = aPrime.x + t * (bPrime.x - aPrime.x);
    const baseY = aPrime.y + t * (bPrime.y - aPrime.y);
    const sign = j % 2 === 0 ? 1 : -1;
    polyline.push({ x: baseX + sign * AMP * perpX, y: baseY + sign * AMP * perpY });
  }
  polyline.push(bPrime, { x: b.x, y: b.y });

  const out: LearningShape[] = [];
  for (let i = 1; i < polyline.length; i++) {
    out.push({
      type: 'line',
      x1: polyline[i - 1].x,
      y1: polyline[i - 1].y,
      x2: polyline[i].x,
      y2: polyline[i].y,
      color,
      stroke: 'normal',
    });
  }
  return out;
}

function vectorShapes(v: PhysicsVector, bodyById: Map<string, LearningPhysicsBody>): LearningShape[] {
  let ax: number;
  let ay: number;
  let anchorRadius = 0;
  if (v.body) {
    const anchor = bodyById.get(v.body);
    if (!anchor) return [];
    ax = anchor.x;
    ay = anchor.y;
    anchorRadius = anchor.radius ?? 12;
  } else {
    ax = v.x ?? 0;
    ay = v.y ?? 0;
  }
  const scale = v.scale ?? 1;
  const color = v.color ?? 'series-5';
  const tx = ax + v.dx * scale;
  const ty = ay + v.dy * scale;

  const out: LearningShape[] = [{ type: 'arrow', x1: ax, y1: ay, x2: tx, y2: ty, color, stroke: 'bold', dash: v.dash }];
  if (v.label) {
    const len = Math.hypot(tx - ax, ty - ay);
    const ux = len > 1e-6 ? (tx - ax) / len : 0;
    const uy = len > 1e-6 ? (ty - ay) / len : -1;
    const reach = Math.max(len, anchorRadius) + 8;
    out.push({
      type: 'text',
      x: ax + reach * ux,
      y: ay + reach * uy,
      text: v.label,
      textCase: 'verbatim',
      color,
      textSize: 'sm',
      align: 'center',
    });
  }
  return out;
}

function angleMarkerShapes(a: PhysicsAngleMarker): LearningShape[] {
  const radius = a.radius ?? 26;
  const color = a.color ?? 'series-4';
  const out: LearningShape[] = [
    {
      type: 'ellipse',
      x: a.x,
      y: a.y,
      width: radius * 2,
      height: radius * 2,
      startAngle: a.from,
      endAngle: a.to,
      color,
      stroke: 'normal',
    },
  ];
  if (a.label) {
    const mid = ((a.from + a.to) / 2) * (Math.PI / 180);
    out.push({
      type: 'text',
      x: a.x + (radius + 13) * Math.cos(mid),
      y: a.y + (radius + 13) * Math.sin(mid),
      text: a.label,
      textCase: 'verbatim',
      color,
      textSize: 'sm',
      align: 'center',
    });
  }
  return out;
}

function fieldShapes(field: PhysicsField, canvasWidth: number, canvasHeight: number): LearningShape[] {
  const spacing = field.spacing ?? 48;
  const size = field.size ?? 14;
  const color = field.color ?? 'guide';
  const regionX = field.x ?? 0;
  const regionY = field.y ?? 0;
  const regionW = field.width ?? canvasWidth;
  const regionH = field.height ?? canvasHeight;

  const out: LearningShape[] = [];
  for (let gx = regionX + spacing / 2; gx < regionX + regionW; gx += spacing) {
    for (let gy = regionY + spacing / 2; gy < regionY + regionH; gy += spacing) {
      if (field.kind === 'arrows') {
        const rad = ((field.angle ?? 0) * Math.PI) / 180;
        const hx = (Math.cos(rad) * size) / 2;
        const hy = (Math.sin(rad) * size) / 2;
        out.push({ type: 'arrow', x1: gx - hx, y1: gy - hy, x2: gx + hx, y2: gy + hy, color, stroke: 'normal' });
      } else if (field.kind === 'into') {
        const r = size / 3;
        const d = 0.6 * r * Math.SQRT1_2;
        out.push({ type: 'circle', x: gx, y: gy, radius: r, color });
        out.push({ type: 'line', x1: gx - d, y1: gy - d, x2: gx + d, y2: gy + d, color, stroke: 'thin' });
        out.push({ type: 'line', x1: gx - d, y1: gy + d, x2: gx + d, y2: gy - d, color, stroke: 'thin' });
      } else {
        const r = size / 3;
        out.push({ type: 'circle', x: gx, y: gy, radius: r, color });
        out.push({ type: 'circle', x: gx, y: gy, radius: 1.5, color, fill: color, fillStyle: 'solid' });
      }
    }
  }
  return out;
}

function meterShapes(meters: PhysicsMeter[], canvasHeight: number): LearningShape[] {
  const n = meters.length;
  const out: LearningShape[] = [];
  const sharedMax = Math.max(1e-6, ...meters.map((m) => m.value));
  meters.forEach((meter, i) => {
    const rowY = canvasHeight - 10 - 16 * (n - i);
    const color = meter.color ?? seriesTone(i);
    const M = meter.max ?? sharedMax;
    const w = Math.round(Math.min(1, Math.max(0, meter.value / M)) * 110);
    out.push({ type: 'text', x: 8, y: rowY + 8, text: meter.label, tone: 'label', textSize: 'xs' });
    out.push({ type: 'rect', x: 52, y: rowY, width: w, height: 10, color, fill: color, fillStyle: 'solid' });
    out.push({
      type: 'text',
      x: 166,
      y: rowY + 8,
      text: formatMeterValue(meter.value),
      tone: 'label',
      textSize: 'xs',
    });
  });
  return out;
}

export interface PhysicsCanvasProps extends Omit<React.AriaAttributes, keyof A11yProps>, A11yProps {
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
  /** Painter: 2D raster (default) or 3D mesh scene via the lazy three.js host. */
  mode?: '2d' | '3d';
  /** 3D only: neutral camera pose ({ mode, zoom, fov, azimuth, target }). */
  camera?: Camera;
  /** 3D only: scene light rig as data. */
  lighting?: CanvasLighting;
  /** 3D only: post-processing stack (bloom/vignette). */
  post?: CanvasPost;
  bodies?: LearningPhysicsBody[];
  constraints?: LearningPhysicsConstraint[];
  showVelocity?: boolean;
  showForces?: boolean;
  velocityScale?: number;
  forceScale?: number;
  /** Ground/wall/ramp/box/pivot scene fixtures. 2D only. */
  sceneObjects?: PhysicsSceneObject[];
  /** Fading trajectory polylines (2D) / trajectory tubes (3D). */
  trails?: PhysicsTrail[];
  /** Named force/velocity/free-body arrows, anchored by point or by body id. 2D only. */
  vectors?: PhysicsVector[];
  /** A 3D height-field surface mesh (wave, terrain, potential well). 3D only. */
  surface3d?: PhysicsSurface3D;
  /** Labeled 3D arrows (field arrows, axis triads). 3D only. */
  vectors3d?: PhysicsVector3D[];
  /** Multiplies every `vectors3d` entry's `dx`/`dy`/`dz` (default 1). 3D only. */
  vectorScale?: number;
  /** Angle arcs between two bearings. 2D only. */
  angles?: PhysicsAngleMarker[];
  /** A single uniform vector/into/out field lattice. 2D only. */
  field?: PhysicsField;
  /** Bottom-left labeled bar gauges. 2D only. */
  meters?: PhysicsMeter[];
  /** Extra declarative shapes in canvas pixel coordinates (2D mode only — ignored in 3D). */
  shapes?: LearningShape[];
  /** Top-right status chip row, forwarded to LearningCanvas verbatim. */
  readouts?: LearningReadout[];
  /** Inset sparkline panels, forwarded to LearningCanvas verbatim. */
  traces?: LearningTracePanel[];
  /** 3D only: show the ground grid (default off). */
  showGrid?: boolean;
  /** 3D only: enable shadows. Omitted → the host default. */
  shadows?: boolean;
  /** 2D: pointer interaction (click/hover). 3D: orbit camera controls. */
  interactive?: boolean;
  /** 2D only: continuous redraw loop. 3D motion is entity-state driven. */
  animate?: boolean;
  onShapeClick?: (payload: { id?: string; type?: string; index: number }) => void;
  isLoading?: boolean;
  error?: UiError | null;
}

export const PhysicsCanvas: React.FC<PhysicsCanvasProps> = ({
  className,
  width = 600,
  height = 400,
  title,
  backgroundColor,
  series,
  keyMap,
  keyUpMap,
  mode = '2d',
  camera,
  lighting,
  post,
  bodies = [],
  constraints = [],
  showVelocity = true,
  showForces = false,
  velocityScale = 20,
  forceScale = 20,
  sceneObjects = [],
  trails = [],
  vectors = [],
  surface3d,
  vectors3d = [],
  vectorScale = 1,
  angles = [],
  field,
  meters = [],
  shapes = [],
  readouts,
  traces,
  showGrid,
  shadows,
  interactive,
  animate = false,
  onShapeClick,
  isLoading,
  error,
  ...rest
}) => {

  const derivedShapes: LearningShape[] = useMemo(() => {
    const out: LearningShape[] = [];
    const bodyById = new Map<string, LearningPhysicsBody>();
    for (const b of bodies) {
      if (b.id) bodyById.set(b.id, b);
    }

    if (field) out.push(...fieldShapes(field, width, height));

    for (const obj of sceneObjects) out.push(...sceneObjectShapes(obj, width, height));

    for (const trail of trails) out.push(...trailShapes(trail));

    for (const c of constraints) {
      const a = bodyById.get(c.from);
      const b = bodyById.get(c.to);
      if (!a || !b) continue;
      out.push(...constraintShapes(c, a, b));
    }

    bodies.forEach((b, bi) => {
      const bodyColor = b.color ?? seriesTone(bi);
      out.push({
        type: 'circle',
        x: b.x,
        y: b.y,
        radius: b.radius ?? 12,
        color: bodyColor,
        fill: bodyColor,
        fillStyle: 'solid',
        id: b.id,
      });
      if (b.label) {
        out.push({
          type: 'text',
          x: b.x + (b.radius ?? 12) + 6,
          y: b.y - (b.radius ?? 12) - 6,
          text: b.label,
          tone: 'ink',
          textSize: 'sm',
        });
      }
      if (showVelocity && b.vx != null && b.vy != null && (b.vx !== 0 || b.vy !== 0)) {
        out.push({
          type: 'arrow',
          x1: b.x,
          y1: b.y,
          x2: b.x + b.vx * velocityScale,
          y2: b.y + b.vy * velocityScale,
          color: 'series-3',
          stroke: 'bold',
        });
      }
      if (showForces && b.fx != null && b.fy != null && (b.fx !== 0 || b.fy !== 0)) {
        out.push({
          type: 'arrow',
          x1: b.x,
          y1: b.y,
          x2: b.x + b.fx * forceScale,
          y2: b.y + b.fy * forceScale,
          color: 'series-5',
          stroke: 'bold',
        });
      }
    });

    for (const v of vectors) out.push(...vectorShapes(v, bodyById));

    for (const a of angles) out.push(...angleMarkerShapes(a));

    if (meters.length > 0) out.push(...meterShapes(meters, height));

    out.push(...shapes);
    return out;
  }, [
    bodies,
    constraints,
    showVelocity,
    showForces,
    velocityScale,
    forceScale,
    sceneObjects,
    trails,
    vectors,
    angles,
    field,
    meters,
    shapes,
    width,
    height,
  ]);

  const drawables3D: DrawableNode[] = useMemo(() => {
    if (mode !== '3d') return [];
    // The 3D host resolves tone names against the theme.
    const tone3d = (value: string | undefined, fallback: DiagramTone): string => value ?? fallback;
    if (shapes.length > 0) {
      physicsLog.debug('shapes ignored in 3D mode (pixel-authored 2D vocabulary)', { count: shapes.length });
    }
    if (sceneObjects.length > 0) {
      physicsLog.debug('sceneObjects ignored in 3D mode (pixel-authored 2D vocabulary)', { count: sceneObjects.length });
    }
    if (vectors.length > 0) {
      physicsLog.debug('vectors ignored in 3D mode (pixel-authored 2D vocabulary)', { count: vectors.length });
    }
    if (angles.length > 0) {
      physicsLog.debug('angles ignored in 3D mode (pixel-authored 2D vocabulary)', { count: angles.length });
    }
    if (field) {
      physicsLog.debug('field ignored in 3D mode (pixel-authored 2D vocabulary)');
    }
    if (meters.length > 0) {
      physicsLog.debug('meters ignored in 3D mode (pixel-authored 2D vocabulary)', { count: meters.length });
    }
    if (animate) {
      physicsLog.debug('animate ignored in 3D mode (motion is entity-state driven)');
    }
    const out: DrawableNode[] = [];
    const labelColor = 'ink';
    const bodyById = new Map<string, LearningPhysicsBody>();
    for (const b of bodies) {
      if (b.id) bodyById.set(b.id, b);
    }

    for (const c of constraints) {
      const a = bodyById.get(c.from);
      const b = bodyById.get(c.to);
      if (!a || !b) continue;
      const rodRadius = Math.max(0.05, Math.min(a.radius ?? 0.5, b.radius ?? 0.5) * 0.15);
      const rod = cylinderBetween([a.x, a.y, a.z ?? 0], [b.x, b.y, b.z ?? 0], rodRadius, tone3d(c.color, 'ink'));
      if (rod) out.push(rod);
    }

    bodies.forEach((b, bi) => {
      const radius = b.radius ?? 0.5;
      const bz = b.z ?? 0;
      out.push(meshSphere(b.id, b.x, b.y, bz, radius, tone3d(b.color, seriesTone(bi))));
      if (b.label) {
        out.push(billboardLabel(b.label, b.x, b.y, bz + radius, { color: labelColor }));
      }
      const vx = b.vx ?? 0;
      const vy = b.vy ?? 0;
      const vz = b.vz ?? 0;
      const arrowRadius = Math.max(0.05, radius * 0.15);
      if (showVelocity && (vx !== 0 || vy !== 0 || vz !== 0)) {
        const arrow = arrowBetween(
          [b.x, b.y, bz],
          [b.x + vx * velocityScale, b.y + vy * velocityScale, bz + vz * velocityScale],
          tone3d('series-3', 'series-3'),
          arrowRadius,
        );
        if (arrow) out.push(arrow);
      }
      const fx = b.fx ?? 0;
      const fy = b.fy ?? 0;
      const fz = b.fz ?? 0;
      if (showForces && (fx !== 0 || fy !== 0 || fz !== 0)) {
        const arrow = arrowBetween(
          [b.x, b.y, bz],
          [b.x + fx * forceScale, b.y + fy * forceScale, bz + fz * forceScale],
          tone3d('series-5', 'series-5'),
          arrowRadius,
        );
        if (arrow) out.push(arrow);
      }
    });

    for (const trail of trails) {
      if (trail.fade !== undefined) {
        physicsLog.debug('trail.fade ignored in 3D mode (2D-only fade curve — 3D draws an opaque tube)', { id: trail.id });
      }
      const points: Learning3DPoint[] = trail.points.map((p) => [p.x, p.y, p.z ?? 0]);
      out.push(
        ...polylineTube(points, trail.width ?? 0.05, tone3d(trail.color, 'guide'), {
          ...(trail.opacity !== undefined ? { opacity: trail.opacity } : {}),
        }),
      );
    }

    if (surface3d) {
      out.push(
        ...heightFieldMesh({
          ...surface3d,
          color: tone3d(surface3d.color, 'series-1'),
          bands: surface3d.bands?.map((band) => ({ ...band, color: tone3d(band.color, 'series-1') })),
        }),
      );
    }

    if (vectors3d.length > 0) {
      out.push(
        ...arrowField(
          vectors3d.map((v) => ({
            id: v.id,
            from: [v.x, v.y, v.z ?? 0] as Learning3DPoint,
            delta: [v.dx, v.dy, v.dz ?? 0] as Learning3DPoint,
            color: tone3d(v.color, 'series-5'),
            label: v.label,
            width: v.width,
          })),
          { scale: vectorScale, labelColor },
        ),
      );
    }
    return out;
  }, [
    mode,
    bodies,
    constraints,
    showVelocity,
    showForces,
    velocityScale,
    forceScale,
    shapes,
    sceneObjects,
    trails,
    vectors,
    surface3d,
    vectors3d,
    vectorScale,
    angles,
    field,
    meters,
    animate,
    backgroundColor,
  ]);

  /**
   * Click id→index map. `vectors3d` entries are keyed by their own index
   * within `vectors3d`; on an id collision with a body, the body wins (set last).
   */
  const bodyIndexById = useMemo(() => {
    const m = new Map<string, number>();
    vectors3d.forEach((v, i) => {
      if (v.id) m.set(v.id, i);
    });
    bodies.forEach((b, i) => {
      if (b.id) m.set(b.id, i);
    });
    return m;
  }, [bodies, vectors3d]);

  if (mode === '3d') {
    return (
        <LearningScene3D
          {...domPassthrough(rest)}
          className={className}
          width={width}
          height={height}
          title={title}
          backgroundColor={backgroundColor}
          series={series}
          drawables={drawables3D}
          camera={camera}
          lighting={lighting}
          post={post}
          showGrid={showGrid}
          shadows={shadows}
          interactive={interactive}
          isLoading={isLoading}
          error={error}
          onItemClick={get3DClickPayload(onShapeClick, bodyIndexById)}
        />
    );
  }

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
            shapes={derivedShapes}
            readouts={readouts}
            traces={traces}
            interactive={interactive ?? false}
            animate={animate}
            onShapeClick={onShapeClick}
            isLoading={isLoading}
            error={error}
          />
        </VStack>
      </Card>
  );
};
