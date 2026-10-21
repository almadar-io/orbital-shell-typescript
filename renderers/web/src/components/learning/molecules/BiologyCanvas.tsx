'use client';

/**
 * BiologyCanvas
 *
 * A field-scoped learning molecule for biology. Renders cells, organelles,
 * membranes, and connections on top of the declarative `LearningCanvas` atom.
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
import type { LearningShape, LearningPoint, LearningReadout, LearningTracePanel } from '../atoms/LearningCanvas';
import type { UiError } from '../../../core';
import type { DrawableNode } from '../../../lib/drawable/paintDispatch';
import type { CanvasLighting, CanvasPost } from '../../../lib/drawable/three/Canvas3DHost';
import type { MeshShapeKind } from '../../game/atoms/DrawMesh';
import {
  LearningScene3D,
  billboardLabel,
  cylinderBetween,
  get3DClickPayload,
  helixDrawables,
  meshSphere,
} from './learningScene3D';

const biologyLog = createLogger('almadar:ui:biology-canvas');

export interface BiologyNode {
  id?: string;
  x: number;
  y: number;
  /** 3D mode only: height in scene cells (2D ignores it). */
  z?: number;
  radius?: number;
  color?: string;
  label?: string;
  kind?: 'cell' | 'organelle' | 'molecule' | 'organism';
  /** 3D mode only: mesh primitive (default 'sphere'; organelles read well as 'capsule'). */
  shape?: MeshShapeKind;
  /** 3D mode only: 0..1 mesh opacity (translucent shells, e.g. a cell membrane). */
  opacity?: number;
  /** Visual emphasis (default 'default'). 2D only. */
  state?: BiologyNodeState;
}

/** Node emphasis vocabulary: 'highlight' rings the node, 'muted' fades node + label to 0.35 opacity. */
export type BiologyNodeState = 'default' | 'highlight' | 'muted';

export interface BiologyEdge {
  from: string;
  to: string;
  color?: string;
  label?: string;
  /**
   * Draws a rim-shortened arrowhead instead of a plain line (default false). 2D only.
   * @synonyms arrow, flow direction
   */
  directed?: boolean;
}

/** An organelle/cell-boundary ellipse outline. */
export interface BiologyCompartment {
  x: number;
  y: number;
  /** Ellipse full width (diameter). */
  width: number;
  /** Ellipse full height (diameter). */
  height: number;
  /** Centered near the top of the ellipse. */
  label?: string;
  /** Outline color: a tone name, token or literal (default `ink`). */
  color?: string;
  /** Fill color: a tone name, token or literal (default = `color`, tinted). */
  fill?: string;
  dash?: 'dashed' | 'dotted';
  /** Outline stroke width in px (default the theme's normal stroke). */
  lineWidth?: number;
}

/** A horizontal background stripe spanning the canvas (e.g. a trophic level or elevation zone). */
export interface BiologyBand {
  label?: string;
  /** Fill/stroke color: a tone name, token or literal (default cycles `series-1`..`series-8` by index). */
  color?: string;
}

const SERIES_TONES: readonly DiagramTone[] = ['series-1', 'series-2', 'series-3', 'series-4', 'series-5', 'series-6', 'series-7', 'series-8'];

function seriesTone(i: number): DiagramTone {
  return SERIES_TONES[i % SERIES_TONES.length];
}

export type BiologyStageState = 'pending' | 'active' | 'done';

const BIO_STAGE_FILL: Record<BiologyStageState, DiagramTone> = {
  pending: 'fill',
  active: 'primary',
  done: 'muted',
};

const BIO_STAGE_TEXT: Record<BiologyStageState, DiagramTone> = {
  pending: 'label',
  active: 'ink',
  done: 'ink',
};

/** A phase/step chip in a `stages` timeline or ring. */
export interface BiologyStage {
  label: string;
  /** Progress state driving fill/text color (default 'pending'). */
  state?: BiologyStageState;
  /** Overrides the state-derived fill: a tone name, token or literal. */
  color?: string;
}

/** One base pair (rung) of a `helix` ladder. */
export interface BiologyHelixRung {
  /** Base letter on strand A (top). */
  a?: string;
  /** Base letter on strand B (bottom). */
  b?: string;
  /** 'new' renders the rung in the newly-synthesized color (default `accent`); 'open'/'paired' drive strand separation. */
  state?: 'paired' | 'open' | 'new';
  /** Overrides the state-derived rung color. */
  color?: string;
}

/** A DNA double-helix ladder rendered as two strand polylines plus rungs, with an optional unzipped fork. */
export interface BiologyHelix {
  /** Panel left edge (default 24). */
  x?: number;
  /** Panel top edge (default canvas height * 0.25). */
  y?: number;
  /** Panel width (default canvas width - 48). */
  width?: number;
  /** Panel height (default canvas height * 0.5). */
  height?: number;
  rungs: BiologyHelixRung[];
  /** Unzipped fraction from the left, 0..1 (default 0 = fully paired). */
  fork?: number;
  /** Strand A (top) color: a tone name, token or literal (default `series-1`). */
  colorA?: string;
  /** Strand B (bottom) color: a tone name, token or literal (default `series-2`). */
  colorB?: string;
  /** Default paired-rung color: a tone name, token or literal (default `muted`). */
  rungColor?: string;
}

/** One base-pair rung of a 3D `helix3d` ladder. */
export interface BiologyHelixRung3D {
  /** Clickable when present — stamped on this rung's marker sphere. */
  id?: string;
  /** Rung cylinder + marker color: a tone name, token or literal (default `muted`). */
  color?: string;
  /** Marker sphere radius override (e.g. selection enlargement). */
  radius?: number;
  /** Billboard label above the marker. */
  label?: string;
}

/**
 * A 3D DNA double-helix: two beaded backbone strands plus a base-pair rung
 * per index, optionally unwound (replication-fork style) at one end. 3D only.
 * @synonyms DNA double helix, base pairs 3D
 */
export interface BiologyHelix3D {
  /** Rung count; defaults to `rungs.length`. One of `count`/`rungs` is required. */
  count?: number;
  /** Per-rung overrides, padded with defaults up to `count`. */
  rungs?: BiologyHelixRung3D[];
  /** Helix radius in scene cells (default 1). */
  radius?: number;
  /** Rise per rung along the helix axis (default 0.34). */
  rise?: number;
  /** Twist per rung in degrees (default 36). */
  twistDeg?: number;
  /** Strand A (top) color: a tone name, token or literal (default `series-1`). */
  strandAColor?: string;
  /** Strand B (bottom) color: a tone name, token or literal (default `series-2`). */
  strandBColor?: string;
  /** Backbone strand cylinder + bead radius (default 0.16). */
  backboneRadius?: number;
  /** Rung cylinder radius, and the marker sphere's default radius (default 0.12). */
  rungRadius?: number;
  /** Helix center; the helix axis runs along scene y. */
  x?: number;
  y?: number;
  z?: number;
  /** Rungs `0..unwoundCount-1` spread by `unwindSpread` instead of `radius` (default 0). */
  unwoundCount?: number;
  /** Spread multiplier for unwound rungs (default 1.8). */
  unwindSpread?: number;
}

export interface BiologyCanvasProps extends Omit<React.AriaAttributes, keyof A11yProps>, A11yProps {
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
  nodes?: BiologyNode[];
  edges?: BiologyEdge[];
  /**
   * Organelle/membrane/cell-boundary ellipses (2D only).
   * @synonyms membrane, organelle region, cell boundary
   */
  compartments?: BiologyCompartment[];
  /**
   * Full-width horizontal background stripes, drawn first (2D only).
   * @synonyms trophic levels, zones, layers
   */
  bands?: BiologyBand[];
  /**
   * Phase/step chips (2D only).
   * @synonyms phases, timeline, cycle
   */
  stages?: BiologyStage[];
  /** Layout for `stages`: a bottom timeline strip (default) or a radial ring. */
  stageStyle?: 'timeline' | 'ring';
  /**
   * A DNA double-helix ladder panel (2D only).
   * @synonyms DNA ladder, replication fork, base pairs
   */
  helix?: BiologyHelix;
  /** A 3D DNA double-helix ladder. 3D only. */
  helix3d?: BiologyHelix3D;
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

export const BiologyCanvas: React.FC<BiologyCanvasProps> = ({
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
  nodes = [],
  edges = [],
  compartments = [],
  bands = [],
  stages = [],
  stageStyle = 'timeline',
  helix,
  helix3d,
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
    const nodeById = new Map<string, BiologyNode>();
    for (const n of nodes) {
      if (n.id) nodeById.set(n.id, n);
    }

    const bandCount = bands.length;
    for (let i = 0; i < bandCount; i++) {
      const band = bands[i];
      const bandColor = band.color ?? seriesTone(i);
      const bandY = (i * height) / bandCount;
      const bandH = height / bandCount;
      out.push({
        type: 'rect',
        x: 0,
        y: bandY,
        width,
        height: bandH,
        color: bandColor,
        fill: bandColor,
        fillStyle: 'tint',
        stroke: 'thin',
        opacity: 0.45,
      });
      if (band.label) {
        out.push({
          type: 'text',
          x: 8,
          y: bandY + 14,
          text: band.label,
          tone: 'label',
          textSize: 'xs',
        });
      }
    }

    for (const c of compartments) {
      const color = c.color ?? 'ink';
      out.push({
        type: 'ellipse',
        x: c.x,
        y: c.y,
        width: c.width,
        height: c.height,
        color,
        fill: c.fill ?? color,
        fillStyle: 'tint',
        ...(c.lineWidth !== undefined ? { lineWidth: c.lineWidth } : { stroke: 'normal' as const }),
        ...(c.dash ? { dash: c.dash } : {}),
      });
      if (c.label) {
        out.push({
          type: 'text',
          x: c.x,
          y: c.y - c.height / 2 + 14,
          text: c.label,
          tone: 'ink',
          textSize: 'sm',
          align: 'center',
        });
      }
    }

    if (helix) {
      const hx = helix.x ?? 24;
      const hy = helix.y ?? height * 0.25;
      const hw = helix.width ?? width - 48;
      const hh = helix.height ?? height * 0.5;
      const rungs = helix.rungs;
      const n = rungs.length;
      const cy = hy + hh / 2;
      const colorA = helix.colorA ?? 'series-1';
      const colorB = helix.colorB ?? 'series-2';
      const rungColor = helix.rungColor ?? 'muted';
      const fork = helix.fork ?? 0;
      const maxSep = Math.min(hh - 8, 96);

      const strandA: LearningPoint[] = [];
      const strandB: LearningPoint[] = [];
      const rungGeoms: { rx: number; sep: number; rung: BiologyHelixRung; paired: boolean }[] = [];
      for (let i = 0; i < n; i++) {
        const rx = hx + ((i + 0.5) * hw) / n;
        const t = (i + 0.5) / n;
        const paired = t >= fork;
        const sep = paired ? 28 : 28 + (maxSep - 28) * ((fork - t) / fork);
        strandA.push({ x: rx, y: cy - sep / 2 });
        strandB.push({ x: rx, y: cy + sep / 2 });
        rungGeoms.push({ rx, sep, rung: rungs[i], paired });
      }
      for (let i = 1; i < n; i++) {
        out.push({ type: 'line', x1: strandA[i - 1].x, y1: strandA[i - 1].y, x2: strandA[i].x, y2: strandA[i].y, color: colorA, stroke: 'bold' });
      }
      for (let i = 1; i < n; i++) {
        out.push({ type: 'line', x1: strandB[i - 1].x, y1: strandB[i - 1].y, x2: strandB[i].x, y2: strandB[i].y, color: colorB, stroke: 'bold' });
      }
      for (const g of rungGeoms) {
        const rColor = g.rung.color ?? (g.rung.state === 'new' ? 'accent' : rungColor);
        const topY = cy - g.sep / 2;
        const bottomY = cy + g.sep / 2;
        if (g.paired) {
          out.push({ type: 'line', x1: g.rx, y1: topY, x2: g.rx, y2: bottomY, color: rColor, stroke: 'thin' });
          if (g.rung.a) {
            out.push({ type: 'text', x: g.rx, y: cy - g.sep / 4, text: g.rung.a, textSize: 'xs', align: 'center', tone: 'label' });
          }
          if (g.rung.b) {
            out.push({ type: 'text', x: g.rx, y: cy + g.sep / 4, text: g.rung.b, textSize: 'xs', align: 'center', tone: 'label' });
          }
        } else {
          const stubTopY = topY + 8;
          const stubBottomY = bottomY - 8;
          out.push({ type: 'line', x1: g.rx, y1: topY, x2: g.rx, y2: stubTopY, color: rColor, stroke: 'thin' });
          out.push({ type: 'line', x1: g.rx, y1: bottomY, x2: g.rx, y2: stubBottomY, color: rColor, stroke: 'thin' });
          if (g.rung.a) {
            out.push({ type: 'text', x: g.rx, y: stubTopY + 6, text: g.rung.a, textSize: 'xs', align: 'center', tone: 'label' });
          }
          if (g.rung.b) {
            out.push({ type: 'text', x: g.rx, y: stubBottomY - 6, text: g.rung.b, textSize: 'xs', align: 'center', tone: 'label' });
          }
        }
      }
    }

    for (const e of edges) {
      const a = nodeById.get(e.from);
      const b = nodeById.get(e.to);
      if (!a || !b) continue;
      const color = e.color ?? 'ink';
      if (e.directed) {
        const rA = a.radius ?? 16;
        const rB = b.radius ?? 16;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.max(1e-6, Math.hypot(dx, dy));
        const ux = dx / dist;
        const uy = dy / dist;
        out.push({
          type: 'arrow',
          x1: a.x + ux * rA,
          y1: a.y + uy * rA,
          x2: b.x - ux * rB,
          y2: b.y - uy * rB,
          color,
          stroke: 'normal',
        });
      } else {
        out.push({
          type: 'line',
          x1: a.x,
          y1: a.y,
          x2: b.x,
          y2: b.y,
          color,
          stroke: 'normal',
        });
      }
      if (e.label) {
        out.push({
          type: 'text',
          x: (a.x + b.x) / 2 + 4,
          y: (a.y + b.y) / 2 - 4,
          text: e.label,
          tone: 'label',
          textSize: 'sm',
        });
      }
    }

    nodes.forEach((n, ni) => {
      const state = n.state ?? 'default';
      const muted = state === 'muted';
      const nodeColor = n.color ?? seriesTone(ni);
      out.push({
        type: 'circle',
        x: n.x,
        y: n.y,
        radius: n.radius ?? 16,
        color: nodeColor,
        fill: nodeColor,
        fillStyle: 'tint',
        stroke: 'normal',
        id: n.id,
        ...(muted ? { opacity: 0.35 } : {}),
      });
      if (state === 'highlight') {
        out.push({
          type: 'circle',
          x: n.x,
          y: n.y,
          radius: (n.radius ?? 16) + 4,
          tone: 'highlight',
          stroke: 'normal',
        });
      }
      if (n.label) {
        out.push({
          type: 'text',
          x: n.x,
          y: n.y + (n.radius ?? 16) + 14,
          text: n.label,
          ...(muted ? { opacity: 0.35 } : {}),
          tone: 'ink',
          textSize: 'sm',
          align: 'center',
        });
      }
    });

    const stageCount = stages.length;
    if (stageCount > 0) {
      if (stageStyle === 'ring') {
        const cx = width / 2;
        const cy = height / 2;
        const R = Math.min(width, height) / 2 - 48;
        const ringPoints: LearningPoint[] = [];
        for (let i = 0; i < stageCount; i++) {
          const angleRad = ((-90 + (360 * i) / stageCount) * Math.PI) / 180;
          ringPoints.push({ x: cx + R * Math.cos(angleRad), y: cy + R * Math.sin(angleRad) });
        }
        if (stageCount >= 2) {
          for (let i = 0; i < stageCount - 1; i++) {
            const p1 = ringPoints[i];
            const p2 = ringPoints[i + 1];
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const dist = Math.max(1e-6, Math.hypot(dx, dy));
            const ux = dx / dist;
            const uy = dy / dist;
            out.push({
              type: 'arrow',
              x1: p1.x + ux * 46,
              y1: p1.y + uy * 46,
              x2: p2.x - ux * 46,
              y2: p2.y - uy * 46,
              tone: 'guide',
              stroke: 'normal',
            });
          }
        }
        for (let i = 0; i < stageCount; i++) {
          const stage = stages[i];
          const state = stage.state ?? 'pending';
          const fill = stage.color ?? BIO_STAGE_FILL[state];
          const w = Math.max(26, Math.min(84, stage.label.length * 6 + 10));
          const h = 18;
          const p = ringPoints[i];
          out.push({ type: 'rect', x: p.x - w / 2, y: p.y - h / 2, width: w, height: h, color: fill, fill, fillStyle: 'tint', stroke: 'normal' });
          out.push({ type: 'text', x: p.x, y: p.y, text: stage.label, tone: BIO_STAGE_TEXT[state], textSize: 'xs', align: 'center' });
        }
      } else {
        const stripY = height - 32;
        const slotW = (width - 16) / stageCount;
        const chipGeoms: { x: number; w: number }[] = [];
        for (let i = 0; i < stageCount; i++) {
          chipGeoms.push({ x: 8 + i * slotW + 5, w: slotW - 10 });
        }
        for (let i = 0; i < stageCount - 1; i++) {
          const midY = stripY + 13;
          out.push({
            type: 'arrow',
            x1: chipGeoms[i].x + chipGeoms[i].w,
            y1: midY,
            x2: chipGeoms[i + 1].x,
            y2: midY,
            tone: 'guide',
            stroke: 'normal',
          });
        }
        for (let i = 0; i < stageCount; i++) {
          const stage = stages[i];
          const state = stage.state ?? 'pending';
          const fill = stage.color ?? BIO_STAGE_FILL[state];
          const g = chipGeoms[i];
          out.push({ type: 'rect', x: g.x, y: stripY, width: g.w, height: 26, color: fill, fill, fillStyle: 'tint', stroke: 'normal' });
          out.push({
            type: 'text',
            x: g.x + g.w / 2,
            y: stripY + 13,
            text: stage.label,
            tone: BIO_STAGE_TEXT[state],
            textSize: 'xs',
            align: 'center',
          });
        }
      }
    }

    out.push(...shapes);
    return out;
  }, [nodes, edges, compartments, bands, stages, stageStyle, helix, shapes, width, height]);

  const drawables3D: DrawableNode[] = useMemo(() => {
    if (mode !== '3d') return [];
    if (shapes.length > 0) {
      biologyLog.debug('shapes ignored in 3D mode (pixel-authored 2D vocabulary)', { count: shapes.length });
    }
    if (compartments.length > 0 || bands.length > 0 || stages.length > 0 || helix) {
      biologyLog.debug('2D-only families ignored in 3D mode (pixel-authored 2D vocabulary)', {
        compartments: compartments.length,
        bands: bands.length,
        stages: stages.length,
        helix: helix != null,
      });
    }
    if (animate) {
      biologyLog.debug('animate ignored in 3D mode (motion is entity-state driven)');
    }
    // The 3D host resolves tone names against the theme.
    const tone3d = (value: string | undefined, fallback: DiagramTone): string => value ?? fallback;
    const out: DrawableNode[] = [];
    const labelColor = 'ink';
    const nodeById = new Map<string, BiologyNode>();
    for (const n of nodes) {
      if (n.id) nodeById.set(n.id, n);
    }

    for (const e of edges) {
      const a = nodeById.get(e.from);
      const b = nodeById.get(e.to);
      if (!a || !b) continue;
      const edgeRadius = Math.max(0.04, Math.min(a.radius ?? 0.5, b.radius ?? 0.5) * 0.12);
      const edge = cylinderBetween([a.x, a.y, a.z ?? 0], [b.x, b.y, b.z ?? 0], edgeRadius, tone3d(e.color, 'ink'));
      if (edge) out.push(edge);
      if (e.label) {
        out.push(
          billboardLabel(
            e.label,
            (a.x + b.x) / 2,
            (a.y + b.y) / 2,
            ((a.z ?? 0) + (b.z ?? 0)) / 2,
            { color: labelColor },
          ),
        );
      }
    }

    nodes.forEach((n, ni) => {
      const radius = n.radius ?? 0.5;
      const nz = n.z ?? 0;
      out.push(meshSphere(n.id, n.x, n.y, nz, radius, tone3d(n.color, seriesTone(ni)), { shape: n.shape, ...(n.opacity !== undefined ? { opacity: n.opacity } : {}) }));
      if (n.label) {
        out.push(billboardLabel(n.label, n.x, n.y, nz + radius, { color: labelColor }));
      }
    });

    if (helix3d) {
      const rungCount = helix3d.count ?? helix3d.rungs?.length ?? 0;
      const resolvedHelix: BiologyHelix3D = {
        ...helix3d,
        strandAColor: tone3d(helix3d.strandAColor, 'series-1'),
        strandBColor: tone3d(helix3d.strandBColor, 'series-2'),
        rungs: Array.from({ length: rungCount }, (_, i) => ({ ...helix3d.rungs?.[i], color: tone3d(helix3d.rungs?.[i]?.color, 'muted') })),
      };
      out.push(...helixDrawables(resolvedHelix, { labelColor }));
    }
    return out;
  }, [mode, nodes, edges, shapes, compartments, bands, stages, helix, helix3d, animate, backgroundColor]);

  /**
   * Click id→index map. `helix3d` rung markers are keyed by their own index
   * within `helix3d.rungs`; on an id collision with a node, the node wins (set last).
   */
  const nodeIndexById = useMemo(() => {
    const m = new Map<string, number>();
    (helix3d?.rungs ?? []).forEach((rung, i) => {
      if (rung.id) m.set(rung.id, i);
    });
    nodes.forEach((n, i) => {
      if (n.id) m.set(n.id, i);
    });
    return m;
  }, [nodes, helix3d]);

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
        onItemClick={get3DClickPayload(onShapeClick, nodeIndexById)}
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
