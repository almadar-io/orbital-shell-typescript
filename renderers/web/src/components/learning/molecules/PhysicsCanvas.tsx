'use client';

/**
 * PhysicsCanvas
 *
 * A field-scoped learning molecule for physics: bodies, constraints, velocity and force arrows, fixtures, fields
 * and meters in 2D, or a 3D scene, mapped and drawn by orbital-canvas.
 *
 * @packageDocumentation
 */

import * as React from 'react';
import { useMemo } from 'react';
import type { A11yProps, Camera, EventKey, PatternConfig } from '@almadar/core';
import { domPassthrough, useTranslate } from '../../../core';
import { Box, Card, Typography } from '../../../core';
import { VStack } from '../../../core';
import { LearningCanvasState, particlesConfig, shapeClickCallbacks } from '../atoms/LearningCanvas';
import type { LearningParticles, LearningReadout, LearningShape, LearningTracePanel } from '../atoms/LearningCanvas';
import type { UiError } from '../../../core';
import type { CanvasLighting, CanvasPost } from '../../../lib/drawable/scene3dTypes';
import { OrbitalCanvas3D } from '../../../lib/drawable/orbital/OrbitalCanvas3D';
import { OrbitalSceneCanvas } from '../../../lib/drawable/orbital/OrbitalSceneCanvas';
import { cameraConfig } from '../../../lib/drawable/orbital/sceneConfig';

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
export type PhysicsSurfaceBand = {
  /** Inclusive floor height in cells; omit for the catch-all lowest band. */
  min?: number;
  color: string;
};

/**
 * A 3D height-field mesh (a wave, a terrain, a potential surface) rendered
 * from a row-major grid of heights. 3D only.
 * @synonyms heightfield, wave surface, terrain, potential surface
 */
export type PhysicsSurface3D = {
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
};

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
export type PhysicsField = {
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
};

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
  /** Painter: 2D raster (default) or 3D mesh scene, both drawn by orbital-canvas. */
  mode?: '2d' | '3d';
  /** 3D only: neutral camera pose ({ mode, zoom, fov, azimuth, target }). */
  camera?: Camera;
  /** 3D only: scene light rig as data. */
  lighting?: CanvasLighting;
  /** 3D only: post-processing stack (bloom/vignette). */
  post?: CanvasPost;
  bodies?: LearningPhysicsBody[];
  /** 2D mode: packed particles drawn in one pass under the bodies (a GPU readback), instead of a body per particle. */
  particles?: LearningParticles;
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
  /** Top-right status chip row (the LearningCanvas vocabulary). */
  readouts?: LearningReadout[];
  /** Inset sparkline panels (the LearningCanvas vocabulary). */
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
  title,
  width,
  height,
  backgroundColor,
  series,
  keyMap,
  keyUpMap,
  mode,
  camera,
  lighting,
  post,
  bodies,
  particles,
  constraints,
  showVelocity,
  showForces,
  velocityScale,
  forceScale,
  sceneObjects,
  trails,
  vectors,
  surface3d,
  vectors3d,
  vectorScale,
  angles,
  field,
  meters,
  shapes,
  readouts,
  traces,
  showGrid,
  shadows,
  interactive,
  animate,
  onShapeClick,
  isLoading,
  error,
  ...rest
}) => {
  const { t } = useTranslate();
  const config = useMemo<PatternConfig<'physics-canvas'>>(
    () => ({
      type: 'physics-canvas',
      width,
      height,
      backgroundColor,
      series,
      keyMap,
      keyUpMap,
      mode,
      camera: cameraConfig(camera),
      lighting,
      post,
      bodies,
      particles: particlesConfig(particles),
      constraints,
      showVelocity,
      showForces,
      velocityScale,
      forceScale,
      sceneObjects,
      trails,
      vectors,
      surface3d,
      vectors3d,
      vectorScale,
      angles,
      field,
      meters,
      shapes,
      readouts,
      traces,
      showGrid,
      shadows,
      interactive,
      animate,
    }),
    [width, height, backgroundColor, series, keyMap, keyUpMap, mode, camera, lighting, post, bodies, particles, constraints, showVelocity, showForces, velocityScale, forceScale, sceneObjects, trails, vectors, surface3d, vectors3d, vectorScale, angles, field, meters, shapes, readouts, traces, showGrid, shadows, interactive, animate],
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

  if (mode === '3d') {
    return (
      <Card className={className}>
        <VStack gap="sm">
          {title ? <Typography variant="h4">{title}</Typography> : null}
          <Box
            className="mx-auto flex w-full overflow-hidden rounded-container"
            style={{ aspectRatio: `${width ?? 600} / ${height ?? 400}`, maxWidth: `min(100%, calc(70vh * ${width ?? 600} / ${height ?? 400}))` }}
            role="img"
            aria-label={title ?? t('aria.scene3d')}
            {...domPassthrough(rest)}
          >
            <OrbitalCanvas3D
              pattern="physics-canvas"
              config={config}
              series={series}
              keyMap={keyMap}
              keyUpMap={keyUpMap}
              {...(onShapeClick ? { onShapeClick } : {})}
            />
          </Box>
        </VStack>
      </Card>
    );
  }

  return (
    <Card {...domPassthrough(rest)} className={className}>
      <VStack gap="sm">
        {title ? <Typography variant="h4">{title}</Typography> : null}
        <OrbitalSceneCanvas pattern="physics-canvas" config={config} width={width ?? 600} height={height ?? 400} callbacks={callbacks} keyMap={keyMap} keyUpMap={keyUpMap} />
      </VStack>
    </Card>
  );
};
