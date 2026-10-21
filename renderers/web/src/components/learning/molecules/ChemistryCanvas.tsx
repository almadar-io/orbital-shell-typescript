'use client';

/**
 * ChemistryCanvas
 *
 * A field-scoped learning molecule for chemistry. Renders atoms, bonds, and
 * reaction arrows on top of the declarative `LearningCanvas` atom.
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
import type { LearningShape, LearningReadout, LearningTracePanel } from '../atoms/LearningCanvas';
import type { UiError } from '../../../core';
import type { DrawableNode } from '../../../lib/drawable/paintDispatch';
import type { CanvasLighting, CanvasPost } from '../../../lib/drawable/three/Canvas3DHost';
import {
  LearningScene3D,
  arrowBetween,
  billboardLabel,
  cylinderBetween,
  get3DClickPayload,
  latticeDrawables,
  meshSphere,
  type Learning3DPoint,
} from './learningScene3D';

const chemistryLog = createLogger('almadar:ui:chemistry-canvas');

export interface ChemistryAtom {
  id?: string;
  x: number;
  y: number;
  /** 3D mode only: height in scene cells (2D ignores it). */
  z?: number;
  element?: string;
  radius?: number;
  /** Atom color: a tone name, token or literal (default a `series-1`..`series-8` tone per distinct element, in order of first appearance). */
  color?: string;
  /** Ionic charge label (e.g. '2+', '-'), drawn top-right of the atom. 2D only. */
  charge?: string;
  /** Lone electron pairs (clamped 0..4), drawn as compass-positioned dot pairs. 2D only. */
  lonePairs?: number;
}

export interface ChemistryBond {
  from: string;
  to: string;
  type?: 'single' | 'double' | 'triple';
  /** Bond color: a tone name, token or literal (default by `state`). */
  color?: string;
  /** Reaction-state coloring (overridden by an explicit `color`). 2D only. */
  state?: ChemistryBondState;
}

/** Bond reaction-state vocabulary: forming/breaking bonds also render dashed. */
export type ChemistryBondState = 'default' | 'forming' | 'breaking' | 'highlight';

const CHEM_BOND_STATE_COLOR: Record<ChemistryBondState, DiagramTone> = {
  default: 'ink',
  forming: 'series-3',
  breaking: 'series-2',
  highlight: 'highlight',
};

const SERIES_TONES: readonly DiagramTone[] = ['series-1', 'series-2', 'series-3', 'series-4', 'series-5', 'series-6', 'series-7', 'series-8'];

function seriesTone(i: number): DiagramTone {
  return SERIES_TONES[i % SERIES_TONES.length];
}

/** Series tone per distinct element, in order of first appearance; atoms with no element share the first slot. */
function elementTones(atoms: ChemistryAtom[]): Map<string, DiagramTone> {
  const m = new Map<string, DiagramTone>();
  for (const a of atoms) {
    if (a.element !== undefined && !m.has(a.element)) m.set(a.element, seriesTone(m.size));
  }
  return m;
}

function atomTone(a: ChemistryAtom, tones: Map<string, DiagramTone>): DiagramTone {
  return (a.element !== undefined ? tones.get(a.element) : undefined) ?? 'series-1';
}

/** Compass angles (degrees) for up to 4 lone-pair dot clusters around an atom. */
const LONE_PAIR_ANGLES = [-90, 0, 90, 180];

/** A beaker/flask/container outline, optionally split by a divider and filled to a liquid level. */
export interface ChemistryContainer {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Outline color: a tone name, token or literal (default the `ink` tone). */
  color?: string;
  /** Fill color for the outline rect itself (independent of the liquid level fill). */
  fill?: string;
  /** Outline stroke width in px (default the theme's normal stroke). */
  lineWidth?: number;
  /** Vertical divider at the container's mid-width (default 'none'). */
  divider?: 'none' | 'solid' | 'dashed' | 'dotted';
  /** Divider color (default = `color`). */
  dividerColor?: string;
  /** Label centered in the left half, near the top. */
  leftLabel?: string;
  /** Label centered in the right half, near the top. */
  rightLabel?: string;
  /** Label centered below the container. */
  label?: string;
  /** Liquid fill level, 0..1 from the bottom. */
  level?: number;
  /** Liquid fill color: a tone name, token or literal (default the `series-1` tone). */
  levelColor?: string;
}

export interface ChemistryArrow {
  x: number;
  y: number;
  angle?: number;
  length?: number;
  /** Arrow color: a tone name, token or literal (default the `ink` tone). */
  color?: string;
  label?: string;
}

/** One basis site of a `lattice3d` crystal, replicated across the generated block. */
export interface ChemistryLatticeSite {
  /** Basis-site key; bonds reference sites by key, not by generated id. */
  key: string;
  /** Fractional cell offset, 0..1. */
  dx: number;
  dy: number;
  dz: number;
  element?: string;
  /** Marker color: a tone name, token or literal (default a `series-1`..`series-8` tone by basis index). */
  color?: string;
  /** Marker radius (default 0.3). */
  radius?: number;
  /** Replicate on the +x face so the boundary plane completes (n+1 planes along x). */
  xEdge?: boolean;
  /** Replicate on the +y face so the boundary plane completes (n+1 planes along y). */
  yEdge?: boolean;
  /** Replicate on the +z face so the boundary plane completes (n+1 planes along z). */
  zEdge?: boolean;
}

/** A bond rule generating one cylinder per valid `from`→`to` site-instance pair. */
export interface ChemistryLatticeBond {
  /** Basis-site key this bond originates from. */
  from: string;
  /** Basis-site key this bond targets. */
  to: string;
  /** Integer cell-index displacement of `to` relative to `from`'s (i, j, k) (default 0 each). */
  dx?: number;
  dy?: number;
  dz?: number;
  /** Bond color: a tone name, token or literal (default the `ink` tone). */
  color?: string;
}

/**
 * A 3D crystal lattice (simple cubic, BCC, FCC, rock salt, diamond, ...)
 * generated procedurally from a fractional basis + bond rules into a block
 * centered on the origin. 3D only.
 * @synonyms crystal lattice, unit cell, BCC FCC
 */
export interface ChemistryLattice3D {
  basis: ChemistryLatticeSite[];
  /** Unit cells replicated along x/y/z (default 2 each). */
  nx?: number;
  ny?: number;
  nz?: number;
  /** Edge length of one unit cell in scene cells (default 2). */
  latticeConstant?: number;
  bonds?: ChemistryLatticeBond[];
  /** Bond cylinder radius (default 0.06). */
  bondRadius?: number;
  /** Dim every generated site outside unit cell (0,0,0) with `dimColor`; bonds with a dimmed endpoint dim too. */
  highlightCell?: boolean;
  /** Dim color for `highlightCell`: a tone name, token or literal (default the `muted` tone). */
  dimColor?: string;
  /** Billboard each site's `element` above its marker (default false). */
  showLabels?: boolean;
  /** Generated site id (`lat-{key}-{i}-{j}-{k}`, as delivered by onShapeClick) to enlarge and recolor as the selection. */
  selectedId?: string;
  /** Selected-site color: a tone name, token or literal (default the `highlight` tone). */
  selectedColor?: string;
}

export interface ChemistryCanvasProps extends Omit<React.AriaAttributes, keyof A11yProps>, A11yProps {
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
  atoms?: ChemistryAtom[];
  bonds?: ChemistryBond[];
  arrows?: ChemistryArrow[];
  /** Bond line rendering: 'thick' varies stroke width by order (default), 'parallel' draws offset parallel strokes. 2D only. */
  bondStyle?: 'thick' | 'parallel';
  /**
   * Beaker/flask/container outlines (2D only).
   * @synonyms beaker, flask, box, membrane, burette
   */
  containers?: ChemistryContainer[];
  /**
   * Reaction equation text centered at the top of the canvas. 2D only.
   * @synonyms reaction equation, formula
   */
  equation?: string;
  /** Equation text color: a tone name, token or literal (default the `ink` tone). */
  equationColor?: string;
  /** A 3D crystal lattice block (simple cubic, BCC, FCC, rock salt, diamond, ...). 3D only. */
  lattice3d?: ChemistryLattice3D;
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

/** Unit vector perpendicular to the a→b bond axis (scene space) for double/triple bond offsets. */
function bondPerpendicular(a: Learning3DPoint, b: Learning3DPoint): Learning3DPoint {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  // cross(d, height-axis); degenerate for a purely vertical bond → any horizontal axis.
  const px = dy;
  const py = -dx;
  const len = Math.sqrt(px * px + py * py);
  if (len < 1e-6) return [1, 0, 0];
  return [px / len, py / len, 0];
}

export const ChemistryCanvas: React.FC<ChemistryCanvasProps> = ({
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
  atoms = [],
  bonds = [],
  arrows = [],
  bondStyle = 'thick',
  containers = [],
  equation,
  equationColor,
  lattice3d,
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
    const tones = elementTones(atoms);
    const atomById = new Map<string, ChemistryAtom>();
    for (const a of atoms) {
      if (a.id) atomById.set(a.id, a);
    }

    for (const c of containers) {
      const color = c.color ?? 'ink';
      if (c.level != null) {
        const lv = c.level;
        out.push({
          type: 'rect',
          x: c.x + 1,
          y: c.y + c.height * (1 - lv),
          width: c.width - 2,
          height: c.height * lv - 1,
          color: c.levelColor ?? 'series-1',
          fill: c.levelColor ?? 'series-1',
          fillStyle: 'solid',
          stroke: 'thin',
          opacity: 0.5,
        });
      }
      out.push({
        type: 'rect',
        x: c.x,
        y: c.y,
        width: c.width,
        height: c.height,
        color,
        fill: c.fill,
        stroke: 'normal',
        lineWidth: c.lineWidth,
      });
      const divider = c.divider ?? 'none';
      if (divider !== 'none') {
        out.push({
          type: 'line',
          x1: c.x + c.width / 2,
          y1: c.y,
          x2: c.x + c.width / 2,
          y2: c.y + c.height,
          color: c.dividerColor ?? color,
          stroke: 'thin',
          ...(divider === 'dashed' || divider === 'dotted' ? { dash: divider } : {}),
        });
      }
      if (c.leftLabel) {
        out.push({
          type: 'text',
          x: c.x + c.width * 0.25,
          y: c.y + 12,
          text: c.leftLabel,
          tone: 'label',
          textSize: 'sm',
          align: 'center',
        });
      }
      if (c.rightLabel) {
        out.push({
          type: 'text',
          x: c.x + c.width * 0.75,
          y: c.y + 12,
          text: c.rightLabel,
          tone: 'label',
          textSize: 'sm',
          align: 'center',
        });
      }
      if (c.label) {
        out.push({
          type: 'text',
          x: c.x + c.width / 2,
          y: c.y + c.height + 12,
          text: c.label,
          tone: 'ink',
          textSize: 'sm',
          align: 'center',
        });
      }
    }

    for (const b of bonds) {
      const a = atomById.get(b.from);
      const c = atomById.get(b.to);
      if (!a || !c) continue;
      const state = b.state ?? 'default';
      const color = b.color ?? CHEM_BOND_STATE_COLOR[state];
      const dash = state === 'forming' || state === 'breaking' ? 'dashed' : undefined;
      if (bondStyle === 'parallel') {
        const dx = c.x - a.x;
        const dy = c.y - a.y;
        const dist = Math.max(1e-6, Math.hypot(dx, dy));
        const ux = dx / dist;
        const uy = dy / dist;
        const px = -uy;
        const py = ux;
        const offsets = b.type === 'double' ? [-3, 3] : b.type === 'triple' ? [-4, 0, 4] : [0];
        for (const off of offsets) {
          out.push({
            type: 'line',
            x1: a.x + px * off,
            y1: a.y + py * off,
            x2: c.x + px * off,
            y2: c.y + py * off,
            color,
            stroke: 'normal',
            ...(dash ? { dash } : {}),
          });
        }
      } else {
        const strokeWidth = b.type === 'double' ? 4 : b.type === 'triple' ? 6 : 2;
        out.push({
          type: 'line',
          x1: a.x,
          y1: a.y,
          x2: c.x,
          y2: c.y,
          color,
          lineWidth: strokeWidth,
          ...(dash ? { dash } : {}),
        });
      }
    }

    for (const a of arrows) {
      const angle = (a.angle ?? 0) * (Math.PI / 180);
      const len = a.length ?? 60;
      const x2 = a.x + Math.cos(angle) * len;
      const y2 = a.y + Math.sin(angle) * len;
      out.push({
        type: 'arrow',
        x1: a.x,
        y1: a.y,
        x2,
        y2,
        color: a.color ?? 'ink',
        stroke: 'bold',
      });
      if (a.label) {
        out.push({
          type: 'text',
          x: (a.x + x2) / 2,
          y: (a.y + y2) / 2 - 10,
          text: a.label,
          textCase: 'verbatim',
          tone: 'ink',
          textSize: 'sm',
          align: 'center',
        });
      }
    }

    for (const a of atoms) {
      out.push({
        type: 'circle',
        x: a.x,
        y: a.y,
        radius: a.radius ?? 14,
        color: a.color ?? atomTone(a, tones),
        fill: a.color ?? atomTone(a, tones),
        id: a.id,
      });
      if (a.element) {
        out.push({
          type: 'text',
          x: a.x,
          y: a.y,
          text: a.element,
          textCase: 'verbatim',
          tone: 'ink',
          textSize: 'sm',
          align: 'center',
        });
      }
      const r = a.radius ?? 14;
      if (a.charge) {
        out.push({
          type: 'text',
          x: a.x + r * 0.85,
          y: a.y - r * 0.85,
          text: a.charge,
          textCase: 'verbatim',
          tone: 'ink',
          textSize: 'xs',
          align: 'left',
        });
      }
      const lonePairs = Math.max(0, Math.min(4, a.lonePairs ?? 0));
      for (let k = 0; k < lonePairs; k++) {
        const angleRad = (LONE_PAIR_ANGLES[k] * Math.PI) / 180;
        const cx = a.x + (r + 6) * Math.cos(angleRad);
        const cy = a.y + (r + 6) * Math.sin(angleRad);
        const perpX = -Math.sin(angleRad);
        const perpY = Math.cos(angleRad);
        for (const sign of [1, -1]) {
          out.push({
            type: 'circle',
            x: cx + perpX * 2.5 * sign,
            y: cy + perpY * 2.5 * sign,
            radius: 1.5,
            color: 'ink',
            fill: 'ink',
            fillStyle: 'solid',
          });
        }
      }
    }

    if (equation) {
      out.push({
        type: 'text',
        x: width / 2,
        y: 14,
        text: equation,
        textCase: 'verbatim',
        color: equationColor ?? 'ink',
        textSize: 'sm',
        align: 'center',
      });
    }

    out.push(...shapes);
    return out;
  }, [atoms, bonds, arrows, bondStyle, containers, equation, equationColor, shapes, width]);

  const drawables3D: DrawableNode[] = useMemo(() => {
    if (mode !== '3d') return [];
    // The 3D host resolves tone names against the theme.
    const tone3d = (value: string | undefined, fallback: DiagramTone): string => value ?? fallback;
    const tones = elementTones(atoms);
    if (shapes.length > 0) {
      chemistryLog.debug('shapes ignored in 3D mode (pixel-authored 2D vocabulary)', { count: shapes.length });
    }
    if (containers.length > 0) {
      chemistryLog.debug('containers ignored in 3D mode (pixel-authored 2D vocabulary)', { count: containers.length });
    }
    if (animate) {
      chemistryLog.debug('animate ignored in 3D mode (motion is entity-state driven)');
    }
    const out: DrawableNode[] = [];
    const labelColor = 'ink';
    const atomById = new Map<string, ChemistryAtom>();
    for (const a of atoms) {
      if (a.id) atomById.set(a.id, a);
    }

    for (const b of bonds) {
      const a = atomById.get(b.from);
      const c = atomById.get(b.to);
      if (!a || !c) continue;
      const color = tone3d(b.color, 'ink');
      const from: Learning3DPoint = [a.x, a.y, a.z ?? 0];
      const to: Learning3DPoint = [c.x, c.y, c.z ?? 0];
      const perp = bondPerpendicular(from, to);
      const bondRadius = Math.max(0.06, Math.min(a.radius ?? 0.45, c.radius ?? 0.45) * 0.22);
      const step = bondRadius * 2.2;
      const offsets = b.type === 'double' ? [-step, step] : b.type === 'triple' ? [-step, 0, step] : [0];
      for (const off of offsets) {
        const bond = cylinderBetween(
          [from[0] + perp[0] * off, from[1] + perp[1] * off, from[2] + perp[2] * off],
          [to[0] + perp[0] * off, to[1] + perp[1] * off, to[2] + perp[2] * off],
          bondRadius,
          color,
        );
        if (bond) out.push(bond);
      }
    }

    for (const a of arrows) {
      const angle = (a.angle ?? 0) * (Math.PI / 180);
      const len = a.length ?? 60;
      const x2 = a.x + Math.cos(angle) * len;
      const y2 = a.y + Math.sin(angle) * len;
      const arrow = arrowBetween([a.x, a.y, 0], [x2, y2, 0], tone3d(a.color, 'ink'));
      if (arrow) out.push(arrow);
      if (a.label) {
        out.push(billboardLabel(a.label, (a.x + x2) / 2, (a.y + y2) / 2, 0, { color: labelColor }));
      }
    }

    for (const a of atoms) {
      const radius = a.radius ?? 0.45;
      const az = a.z ?? 0;
      out.push(meshSphere(a.id, a.x, a.y, az, radius, tone3d(a.color, atomTone(a, tones))));
      if (a.element) {
        out.push(billboardLabel(a.element, a.x, a.y, az + radius, { color: labelColor }));
      }
    }

    if (lattice3d) {
      out.push(
        ...latticeDrawables(
          {
            ...lattice3d,
            basis: lattice3d.basis.map((site, i) => ({ ...site, color: tone3d(site.color, seriesTone(i)) })),
            bonds: lattice3d.bonds?.map((bond) => ({ ...bond, color: tone3d(bond.color, 'ink') })),
            dimColor: tone3d(lattice3d.dimColor, 'muted'),
            selectedColor: tone3d(lattice3d.selectedColor, 'highlight'),
          },
          { labelColor },
        ),
      );
    }
    return out;
  }, [mode, atoms, bonds, arrows, shapes, containers, lattice3d, animate, backgroundColor]);

  const atomIndexById = useMemo(() => {
    const m = new Map<string, number>();
    atoms.forEach((a, i) => {
      if (a.id) m.set(a.id, i);
    });
    return m;
  }, [atoms]);

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
          onItemClick={get3DClickPayload(onShapeClick, atomIndexById)}
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
