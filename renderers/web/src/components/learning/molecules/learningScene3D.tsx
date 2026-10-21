'use client';

/**
 * learningScene3D — the shared 3D seam for the learning canvas molecules
 * (PhysicsCanvas / BiologyCanvas / ChemistryCanvas), mirroring the game
 * `Canvas` molecule's 2D/3D split: each molecule derives neutral drawable
 * descriptors from its vocabulary and this module hosts them in the lazy
 * `Canvas3DHost`, so three.js/R3F never enters a 2D-only bundle.
 *
 * The lazy import is the code-split boundary: the package's one split ESM build
 * makes it its own chunk (the `./three` entry).
 *
 * Click: the host speaks `EventEmit` (a bus event-name string), so the wrapper
 * mints a per-instance, dot-qualified event name (dot-qualified flows through
 * trait-scope qualification verbatim — a bare key would be scope-rewritten and
 * never reach this listener) and bridges it back to the molecule's
 * `onShapeClick` callback contract via `useEventListener` — the same
 * bus→callback mechanism `MediaGallery`/`StateMachineView` use.
 *
 * The derivation helpers below are pure descriptor builders (no three imports).
 * Scene coordinates are cells: `x`/`y` the ground plane, `z` the height.
 *
 * @packageDocumentation
 */

import * as React from 'react';
import { Suspense, lazy, useId, useRef } from 'react';
import type { A11yProps, Camera } from '@almadar/core';
import { domPassthrough } from '../../../core';
import { useTranslate } from '../../../core';
import { createLogger } from '@almadar/logger';
import type { DrawableNode } from '../../../lib/drawable/paintDispatch';
import type { Canvas3DHostProps, CanvasLighting, CanvasPost } from '../../../lib/drawable/three/Canvas3DHost';
import type { DrawMeshProps, MeshMaterial, MeshShapeKind } from '../../game/atoms/DrawMesh';
import type { DrawTextProps } from '../../game/atoms/DrawText';
import type { DrawGroupProps } from '../../game/atoms/DrawGroup';
import { Box, Card, Typography } from '../../../core';
import { VStack } from '../../../core';
import { useEventListener } from '../../../core';
import type { UiError } from '../../../core';

const sceneLog = createLogger('almadar:ui:learning-scene-3d');

const KNOWN_BLOOM_KEYS = new Set(['intensity', 'threshold', 'smoothing']);

/** Lazy 3D host — see the module header for why this stays an external subpath. */
const Canvas3DHost = lazy(() =>
  import('../../../lib/drawable/three').then((m) => ({ default: m.Canvas3DHost })),
);

/** A point in scene space: `[x, y, z]` — x/y the ground plane, z the height (cells). */
export type Learning3DPoint = [number, number, number];

export interface LearningScene3DProps extends A11yProps {
  /** Text alternative for the scene, rendered as visually hidden text and linked by aria-describedby. */
  description?: string;
  className?: string;
  width?: number;
  height?: number;
  title?: string;
  backgroundColor?: string;
  /** Overrides the theme's categorical palette (`series-1…N`) for this scene. */
  series?: string[];
  /** Neutral drawable descriptors derived from the molecule's vocabulary. */
  drawables: DrawableNode[];
  /** Neutral camera pose; `mode` defaults to 'perspective' for learning scenes. */
  camera?: Camera;
  /** 3D scene light rig as data. Omitted → the host's standard fixed rig. */
  lighting?: CanvasLighting;
  /** 3D post-processing stack (bloom/vignette). Omitted → no post pass. */
  post?: CanvasPost;
  /** Show the 3D ground grid. Default false (the learning scenes' current look). */
  showGrid?: boolean;
  /** Enable 3D shadows. Omitted → the host default (shadows on). */
  shadows?: boolean;
  /** Enable the orbit camera controls. Omitted → the host default (controls on). */
  interactive?: boolean;
  isLoading?: boolean;
  error?: UiError | null;
  /** Fires with the `id` of a clicked descriptor (descriptors carry `id` via DrawableBase). */
  onItemClick?: (id: string) => void;
}

export function LearningScene3D({
  className,
  width = 600,
  height = 400,
  title,
  backgroundColor,
  series,
  drawables,
  camera,
  lighting,
  post,
  showGrid = false,
  shadows,
  interactive,
  isLoading,
  error,
  onItemClick,
  description,
  ...rest
}: LearningScene3DProps): React.JSX.Element {
  const { t } = useTranslate();
  const descId = useId();
  const instanceId = useId().replace(/[^a-zA-Z0-9]/g, '');
  const clickEvent = onItemClick ? `LEARNING_SCENE_3D.ITEM_CLICK.${instanceId}` : undefined;
  const onItemClickRef = useRef(onItemClick);
  onItemClickRef.current = onItemClick;

  useEventListener(`UI:${clickEvent ?? 'LEARNING_SCENE_3D.ITEM_CLICK.__disabled'}`, (event) => {
    const unitId = event.payload?.unitId;
    if (typeof unitId === 'string') onItemClickRef.current?.(unitId);
  });

  if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production' && post?.bloom) {
    const unknownKeys = Object.keys(post.bloom).filter((k) => !KNOWN_BLOOM_KEYS.has(k));
    if (unknownKeys.length > 0) {
      sceneLog.debug('post.bloom has unrecognized keys — only intensity/threshold/smoothing are read', { unknownKeys });
    }
  }

  const props3d: Canvas3DHostProps = {
    drawables,
    isLoading,
    error: error ? error.message : null,
    cameraMode: camera?.mode ?? 'perspective',
    ...(camera?.zoom !== undefined ? { zoom: camera.zoom } : {}),
    ...(camera?.fov !== undefined ? { fov: camera.fov } : {}),
    ...(camera?.azimuth !== undefined ? { azimuth: camera.azimuth } : {}),
    ...(camera?.elevation !== undefined ? { elevation: camera.elevation } : {}),
    ...(camera?.target !== undefined ? { followTarget: camera.target } : {}),
    backgroundColor,
    ...(series !== undefined ? { series } : {}),
    showGrid,
    ...(shadows !== undefined ? { shadows } : {}),
    ...(interactive !== undefined ? { controlsEnabled: interactive } : {}),
    lighting,
    post,
    ...(clickEvent !== undefined ? { unitClickEvent: clickEvent } : {}),
  };

  return (
    <Card className={className}>
      <VStack gap="sm">
        {title ? <Typography variant="h4">{title}</Typography> : null}
        <Box
          className="mx-auto flex w-full overflow-hidden rounded-container"
          style={{ aspectRatio: `${width} / ${height}`, maxWidth: `min(100%, calc(70vh * ${width} / ${height}))` }}
          role="img"
          aria-label={title ?? t('aria.scene3d')}
          aria-describedby={description ? descId : undefined}
          {...domPassthrough(rest)}
        >
          <Suspense fallback={null}>
            <Canvas3DHost {...props3d} />
          </Suspense>
        </Box>
        {description ? <Box id={descId} className="sr-only">{description}</Box> : null}
      </VStack>
    </Card>
  );
}

LearningScene3D.displayName = 'LearningScene3D';

// ---------------------------------------------------------------------------
// Pure descriptor builders (no three imports — the 3D host rasterizes these).
// ---------------------------------------------------------------------------

export interface MeshSphereOpts {
  /** Primitive kind (default 'sphere'; organelles read well as 'capsule'). */
  shape?: MeshShapeKind;
  segments?: number;
  material?: MeshMaterial;
  opacity?: number;
}

/** A sphere (or `opts.shape` primitive) centred at the scene point, `id`-tagged for click. */
export function meshSphere(
  id: string | undefined,
  x: number,
  y: number,
  z: number,
  radius: number,
  color: string,
  opts?: MeshSphereOpts,
): DrawMeshProps {
  return {
    type: 'draw-mesh',
    ...(id !== undefined ? { id } : {}),
    shape: opts?.shape ?? 'sphere',
    position: { x, y, z },
    radius,
    pivot: 'center',
    segments: opts?.segments ?? 24,
    material: { color, ...opts?.material },
    ...(opts?.opacity !== undefined ? { opacity: opts.opacity } : {}),
  };
}

/** Euler `[x, y, z]` aligning a Y-axis primitive (cylinder/cone) with the segment from→to. */
function axisRotation(from: Learning3DPoint, to: Learning3DPoint): [number, number, number] {
  // Scene → world axis map: scene x → world X, scene z (height) → world Y, scene y → world Z.
  const wx = to[0] - from[0];
  const wy = to[2] - from[2];
  const wz = to[1] - from[1];
  const len = Math.sqrt(wx * wx + wy * wy + wz * wz);
  const tilt = Math.acos(Math.min(1, Math.max(-1, len > 0 ? wy / len : 1)));
  return [0, Math.atan2(wz, -wx), tilt];
}

function segmentLength(from: Learning3DPoint, to: Learning3DPoint): number {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** A cylinder spanning from→to, centred on the midpoint. Null when the segment is degenerate. */
export function cylinderBetween(
  from: Learning3DPoint,
  to: Learning3DPoint,
  radius: number,
  color: string,
): DrawMeshProps | null {
  const len = segmentLength(from, to);
  if (len < 1e-6) return null;
  return {
    type: 'draw-mesh',
    shape: 'cylinder',
    position: { x: (from[0] + to[0]) / 2, y: (from[1] + to[1]) / 2, z: (from[2] + to[2]) / 2 },
    radius,
    height: len,
    rotation: axisRotation(from, to),
    pivot: 'center',
    segments: 12,
    material: { color },
  };
}

/**
 * An arrow from→to as a `draw-group` (shaft cylinder + tip cone) local to `from`.
 * `shaftRadius` is in scene cells (default: a thin rod at cell scale). `id`,
 * when given, is stamped on the returned draw-group for click routing.
 */
export function arrowBetween(
  from: Learning3DPoint,
  to: Learning3DPoint,
  color: string,
  shaftRadius = 0.08,
  id?: string,
): DrawGroupProps | null {
  const len = segmentLength(from, to);
  if (len < 1e-6) return null;
  const tipLen = Math.min(shaftRadius * 8, len * 0.35);
  const k = (len - tipLen) / len;
  const delta: Learning3DPoint = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const shaftEnd: Learning3DPoint = [delta[0] * k, delta[1] * k, delta[2] * k];
  const tipStart: Learning3DPoint = shaftEnd;
  const tipEnd: Learning3DPoint = delta;
  const shaft = cylinderBetween([0, 0, 0], shaftEnd, shaftRadius, color);
  const tipLenActual = segmentLength(tipStart, tipEnd);
  const tip: DrawMeshProps = {
    type: 'draw-mesh',
    shape: 'cone',
    position: {
      x: (tipStart[0] + tipEnd[0]) / 2,
      y: (tipStart[1] + tipEnd[1]) / 2,
      z: (tipStart[2] + tipEnd[2]) / 2,
    },
    radius: shaftRadius * 3,
    height: tipLenActual,
    rotation: axisRotation(tipStart, tipEnd),
    pivot: 'center',
    segments: 12,
    material: { color },
  };
  return {
    type: 'draw-group',
    ...(id !== undefined ? { id } : {}),
    position: { x: from[0], y: from[1], z: from[2] },
    items: tipLenActual < 1e-6 ? (shaft ? [shaft] : []) : shaft ? [shaft, tip] : [tip],
  };
}

/** A billboarded text label above the scene point (the 3D host lifts it off the item). */
export function billboardLabel(
  text: string,
  x: number,
  y: number,
  z: number,
  opts?: { color?: string },
): DrawTextProps {
  return {
    type: 'draw-text',
    text,
    position: { x, y, z },
    color: opts?.color ?? 'ink',
  };
}

/**
 * Bridge the 3D host's `{ unitId }` click back to the molecules' 2D
 * `onShapeClick({ id, index })` contract — `index` is the item's position in
 * its vocabulary array (−1 when the id is unknown).
 */
export function get3DClickPayload(
  onShapeClick: ((payload: { id?: string; type?: string; index: number }) => void) | undefined,
  idToIndex: ReadonlyMap<string, number>,
): ((id: string) => void) | undefined {
  if (!onShapeClick) return undefined;
  return (id) => onShapeClick({ id, index: idToIndex.get(id) ?? -1 });
}

// ---------------------------------------------------------------------------
// 3D-only family builders — same composition discipline as above (meshSphere
// / cylinderBetween / arrowBetween / billboardLabel only, no three imports).
// ---------------------------------------------------------------------------

export interface PolylineTubeOpts {
  /** 0..1 opacity applied to every tube segment (default 1, opaque). */
  opacity?: number;
  /** Above this many segments, uniformly downsample keeping the first/last points (default 128). */
  maxSegments?: number;
}

/** A tube through `points` as chained cylinders; degenerate (near-zero-length) segments are skipped. */
export function polylineTube(
  points: Learning3DPoint[],
  radius: number,
  color: string,
  opts?: PolylineTubeOpts,
): DrawableNode[] {
  const maxSegments = opts?.maxSegments ?? 128;
  let pts = points;
  if (pts.length - 1 > maxSegments) {
    const step = (pts.length - 1) / maxSegments;
    const kept: Learning3DPoint[] = [pts[0]];
    for (let s = 1; s < maxSegments; s++) kept.push(pts[Math.round(s * step)]);
    kept.push(pts[pts.length - 1]);
    pts = kept;
  }
  const out: DrawableNode[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const seg = cylinderBetween(pts[i], pts[i + 1], radius, color);
    if (seg) out.push(opts?.opacity !== undefined ? { ...seg, opacity: opts.opacity } : seg);
  }
  return out;
}

/** One elevation band: faces whose centroid height is >= `min` render in `color`. Pass bands sorted ascending by `min`. */
export interface HeightFieldBand {
  /** Inclusive floor height in cells; omit for the catch-all lowest band. */
  min?: number;
  color: string;
}

export interface HeightFieldSpec {
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
  /** Elevation color bands, sorted ascending by `min`; omitted → a single flat-colored sheet. */
  bands?: HeightFieldBand[];
  /** Fallback color when `bands` is omitted: a tone name, token or literal (default `series-1`). */
  color?: string;
  opacity?: number;
  /** Faceted low-poly shading (default true). */
  flatShading?: boolean;
}

/**
 * An `nx`×`ny` vertex sheet (two CCW-from-above triangles per quad), partitioned
 * by per-face centroid height into `bands`. One `polyhedron` DrawMesh per
 * non-empty band, sharing the full vertex array (faces disjoint). Not clickable.
 */
export function heightFieldMesh(spec: HeightFieldSpec): DrawMeshProps[] {
  const { nx, ny, heights, spacing = 1, x = 0, y = 0 } = spec;
  const flatShading = spec.flatShading ?? true;
  const vertices: number[][] = [];
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      vertices.push([
        x + (ix - (nx - 1) / 2) * spacing,
        y + (iy - (ny - 1) / 2) * spacing,
        heights[iy * nx + ix] ?? 0,
      ]);
    }
  }
  const bands = [...(spec.bands ?? [])].sort((a, b) => (a.min ?? -Infinity) - (b.min ?? -Infinity));
  const facesByBand = new Map<HeightFieldBand | null, number[][]>();
  for (let iy = 0; iy < ny - 1; iy++) {
    for (let ix = 0; ix < nx - 1; ix++) {
      const v00 = iy * nx + ix;
      const v10 = iy * nx + ix + 1;
      const v01 = (iy + 1) * nx + ix;
      const v11 = (iy + 1) * nx + ix + 1;
      for (const face of [[v00, v10, v01], [v10, v11, v01]]) {
        const centroid = (vertices[face[0]][2] + vertices[face[1]][2] + vertices[face[2]][2]) / 3;
        let band: HeightFieldBand | null = null;
        for (const b of bands) {
          if ((b.min ?? -Infinity) <= centroid) band = b;
        }
        const key = bands.length > 0 ? band : null;
        const list = facesByBand.get(key) ?? [];
        list.push(face);
        facesByBand.set(key, list);
      }
    }
  }
  const out: DrawMeshProps[] = [];
  for (const [band, faces] of facesByBand) {
    if (faces.length === 0) continue;
    out.push({
      type: 'draw-mesh',
      shape: 'polyhedron',
      position: { x: 0, y: 0, z: 0 },
      vertices,
      faces,
      pivot: 'center',
      material: { color: band?.color ?? spec.color ?? 'series-1', flatShading, side: 'double' },
      ...(spec.opacity !== undefined ? { opacity: spec.opacity } : {}),
    });
  }
  return out;
}

export interface ArrowFieldEntry {
  /** Clickable when present — stamped on this entry's draw-group. */
  id?: string;
  from: Learning3DPoint;
  /** Vector components, before `opts.scale`. */
  delta: Learning3DPoint;
  color?: string;
  /** Billboard label at the tip. */
  label?: string;
  /** Shaft radius in scene cells (default: `arrowBetween`'s own default). */
  width?: number;
}

export interface ArrowFieldOpts {
  /** Multiplies every entry's `delta` (default 1). */
  scale?: number;
  labelColor?: string;
}

/** A field of labeled arrows (field arrows, axis triads, force/velocity vectors) via `arrowBetween`. */
export function arrowField(vectors: ArrowFieldEntry[], opts?: ArrowFieldOpts): DrawableNode[] {
  const scale = opts?.scale ?? 1;
  const out: DrawableNode[] = [];
  for (const v of vectors) {
    const to: Learning3DPoint = [
      v.from[0] + v.delta[0] * scale,
      v.from[1] + v.delta[1] * scale,
      v.from[2] + v.delta[2] * scale,
    ];
    const arrow = arrowBetween(v.from, to, v.color ?? 'series-5', v.width, v.id);
    if (arrow) out.push(arrow);
    if (v.label) out.push(billboardLabel(v.label, to[0], to[1], to[2], { color: opts?.labelColor }));
  }
  return out;
}

export interface HelixRung {
  /** Clickable when present — stamped on this rung's marker sphere. */
  id?: string;
  /** Rung cylinder + marker color: a tone name, token or literal (default `muted`). */
  color?: string;
  /** Marker sphere radius override (e.g. selection enlargement); default = the spec's `rungRadius`. */
  radius?: number;
  /** Billboard label above the marker. */
  label?: string;
}

export interface HelixSpec {
  /** Rung count; defaults to `rungs.length`. One of `count`/`rungs` is required. */
  count?: number;
  /** Per-rung overrides, padded with `{}` defaults up to `count`. */
  rungs?: HelixRung[];
  /** Helix radius in scene cells (default 1). */
  radius?: number;
  /** Rise per rung along the helix axis (default 0.34). */
  rise?: number;
  /** Twist per rung in degrees (default 36). */
  twistDeg?: number;
  strandAColor?: string;
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

/**
 * A DNA-style double helix: two backbone strands (beaded polylines) plus a
 * base-pair rung per index. Rung markers carry `rung.id` for click routing;
 * backbone beads get deterministic, non-indexed ids (`hx-a-{i}`/`hx-b-{i}`).
 */
export function helixDrawables(spec: HelixSpec, opts?: { labelColor?: string }): DrawableNode[] {
  const count = spec.count ?? spec.rungs?.length ?? 0;
  const rungs: HelixRung[] = Array.from({ length: count }, (_, i) => spec.rungs?.[i] ?? {});
  const radius = spec.radius ?? 1;
  const rise = spec.rise ?? 0.34;
  const twistRad = (spec.twistDeg ?? 36) * (Math.PI / 180);
  const strandAColor = spec.strandAColor ?? 'series-1';
  const strandBColor = spec.strandBColor ?? 'series-2';
  const backboneRadius = spec.backboneRadius ?? 0.16;
  const rungRadius = spec.rungRadius ?? 0.12;
  const cx = spec.x ?? 0;
  const cy = spec.y ?? 0;
  const cz = spec.z ?? 0;
  const unwoundCount = spec.unwoundCount ?? 0;
  const unwindSpread = spec.unwindSpread ?? 1.8;

  const strandA: Learning3DPoint[] = [];
  const strandB: Learning3DPoint[] = [];
  for (let i = 0; i < count; i++) {
    const yi = cy + (i - (count - 1) / 2) * rise;
    const theta = i * twistRad;
    const s = i < unwoundCount ? unwindSpread : 1;
    strandA.push([cx + s * radius * Math.cos(theta), yi, cz + s * radius * Math.sin(theta)]);
    strandB.push([cx + s * radius * Math.cos(theta + Math.PI), yi, cz + s * radius * Math.sin(theta + Math.PI)]);
  }

  const out: DrawableNode[] = [];
  for (let i = 0; i < count; i++) {
    out.push(meshSphere(`hx-a-${i}`, strandA[i][0], strandA[i][1], strandA[i][2], backboneRadius, strandAColor));
    out.push(meshSphere(`hx-b-${i}`, strandB[i][0], strandB[i][1], strandB[i][2], backboneRadius, strandBColor));
    if (i > 0) {
      const segA = cylinderBetween(strandA[i - 1], strandA[i], backboneRadius, strandAColor);
      if (segA) out.push(segA);
      const segB = cylinderBetween(strandB[i - 1], strandB[i], backboneRadius, strandBColor);
      if (segB) out.push(segB);
    }
    const rung = rungs[i];
    const rungColor = rung.color ?? 'muted';
    const rod = cylinderBetween(strandA[i], strandB[i], rungRadius, rungColor);
    if (rod) out.push(rod);
    const mid: Learning3DPoint = [
      (strandA[i][0] + strandB[i][0]) / 2,
      (strandA[i][1] + strandB[i][1]) / 2,
      (strandA[i][2] + strandB[i][2]) / 2,
    ];
    const markerRadius = rung.radius ?? rungRadius;
    out.push(meshSphere(rung.id, mid[0], mid[1], mid[2], markerRadius, rungColor));
    if (rung.label) out.push(billboardLabel(rung.label, mid[0], mid[1], mid[2] + markerRadius, { color: opts?.labelColor }));
  }
  return out;
}

export interface LatticeSite {
  /** Basis-site key; bonds reference sites by key, not by generated id. */
  key: string;
  /** Fractional cell offset, 0..1. */
  dx: number;
  dy: number;
  dz: number;
  element?: string;
  /** Marker color: a tone name, token or literal (default `series-1`). */
  color?: string;
  /** Marker radius (default 0.3). */
  radius?: number;
  /** Replicate on the +x/+y/+z face so the boundary plane completes (n+1 planes along that axis). */
  xEdge?: boolean;
  yEdge?: boolean;
  zEdge?: boolean;
}

export interface LatticeBond {
  /** Basis-site key this bond originates from. */
  from: string;
  /** Basis-site key this bond targets. */
  to: string;
  /** Integer cell-index displacement of `to` relative to `from`'s (i, j, k) (default 0 each). */
  dx?: number;
  dy?: number;
  dz?: number;
  color?: string;
}

export interface LatticeSpec {
  basis: LatticeSite[];
  /** Unit cells replicated along x/y/z (default 2 each). */
  nx?: number;
  ny?: number;
  nz?: number;
  /** Edge length of one unit cell in scene cells (default 2). */
  latticeConstant?: number;
  bonds?: LatticeBond[];
  /** Bond cylinder radius (default 0.06). */
  bondRadius?: number;
  /** Dim every generated site outside unit cell (0,0,0) with `dimColor`; bonds with a dimmed endpoint dim too. */
  highlightCell?: boolean;
  dimColor?: string;
  /** Billboard each site's `element` above its marker (default false). */
  showLabels?: boolean;
  /** Generated site id (`lat-{key}-{i}-{j}-{k}`) to enlarge and recolor as the selection. */
  selectedId?: string;
  /** Selected-site color: a tone name, token or literal (default `highlight`). */
  selectedColor?: string;
}

/**
 * A crystal lattice block generated from a fractional `basis` + integer-offset
 * `bonds`, centered on the origin. Site ids are `lat-{key}-{i}-{j}-{k}`
 * (clickable, not index-tracked — resolves by id string); bonds whose computed
 * endpoint falls outside the generated block are dropped.
 */
export function latticeDrawables(spec: LatticeSpec, opts?: { labelColor?: string }): DrawableNode[] {
  const nx = spec.nx ?? 2;
  const ny = spec.ny ?? 2;
  const nz = spec.nz ?? 2;
  const latticeConstant = spec.latticeConstant ?? 2;
  const bondRadius = spec.bondRadius ?? 0.06;
  const highlightCell = spec.highlightCell ?? false;
  const dimColor = spec.dimColor ?? 'muted';
  const showLabels = spec.showLabels ?? false;

  const selectedColor = spec.selectedColor ?? 'highlight';
  const posByKey = new Map<string, Learning3DPoint>();
  const inCellByKey = new Map<string, boolean>();
  const out: DrawableNode[] = [];

  for (const site of spec.basis) {
    const snx = site.xEdge ? nx + 1 : nx;
    const sny = site.yEdge ? ny + 1 : ny;
    const snz = site.zEdge ? nz + 1 : nz;
    for (let i = 0; i < snx; i++) {
      for (let j = 0; j < sny; j++) {
        for (let k = 0; k < snz; k++) {
          const key = `${site.key}-${i}-${j}-${k}`;
          const inCell = i + site.dx <= 1 && j + site.dy <= 1 && k + site.dz <= 1;
          const pos: Learning3DPoint = [
            (i + site.dx) * latticeConstant - (nx * latticeConstant) / 2,
            (j + site.dy) * latticeConstant - (ny * latticeConstant) / 2,
            (k + site.dz) * latticeConstant - (nz * latticeConstant) / 2,
          ];
          posByKey.set(key, pos);
          inCellByKey.set(key, inCell);
          const isSelected = spec.selectedId === `lat-${key}`;
          const color = isSelected ? selectedColor : highlightCell && !inCell ? dimColor : site.color ?? 'series-1';
          const radius = (site.radius ?? 0.3) * (isSelected ? 1.4 : 1);
          out.push(meshSphere(`lat-${key}`, pos[0], pos[1], pos[2], radius, color));
          if (showLabels && site.element) {
            out.push(billboardLabel(site.element, pos[0], pos[1], pos[2] + radius, { color: opts?.labelColor }));
          }
        }
      }
    }
  }

  const basisByKey = new Map(spec.basis.map((s) => [s.key, s]));
  for (const bond of spec.bonds ?? []) {
    const fromSite = basisByKey.get(bond.from);
    const toSite = basisByKey.get(bond.to);
    if (!fromSite || !toSite) continue;
    const fnx = fromSite.xEdge ? nx + 1 : nx;
    const fny = fromSite.yEdge ? ny + 1 : ny;
    const fnz = fromSite.zEdge ? nz + 1 : nz;
    const tnx = toSite.xEdge ? nx + 1 : nx;
    const tny = toSite.yEdge ? ny + 1 : ny;
    const tnz = toSite.zEdge ? nz + 1 : nz;
    const bdx = bond.dx ?? 0;
    const bdy = bond.dy ?? 0;
    const bdz = bond.dz ?? 0;
    for (let i = 0; i < fnx; i++) {
      for (let j = 0; j < fny; j++) {
        for (let k = 0; k < fnz; k++) {
          const ti = i + bdx;
          const tj = j + bdy;
          const tk = k + bdz;
          if (ti < 0 || ti >= tnx || tj < 0 || tj >= tny || tk < 0 || tk >= tnz) continue;
          const fromKey = `${fromSite.key}-${i}-${j}-${k}`;
          const toKey = `${toSite.key}-${ti}-${tj}-${tk}`;
          const fromPos = posByKey.get(fromKey);
          const toPos = posByKey.get(toKey);
          if (!fromPos || !toPos) continue;
          const dimmed = highlightCell && !(inCellByKey.get(fromKey) && inCellByKey.get(toKey));
          const seg = cylinderBetween(fromPos, toPos, bondRadius, dimmed ? dimColor : bond.color ?? 'ink');
          if (seg) out.push(seg);
        }
      }
    }
  }
  return out;
}
