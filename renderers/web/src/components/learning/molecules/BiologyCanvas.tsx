'use client';

/**
 * BiologyCanvas
 *
 * A field-scoped learning molecule for biology: nodes, edges, compartments, bands, stages and a DNA helix in 2D,
 * or a 3D scene, mapped and drawn by orbital-canvas.
 *
 * @packageDocumentation
 */

import * as React from 'react';
import { useMemo } from 'react';
import type { A11yProps, Camera, EventKey, PatternConfig } from '@almadar/core';
import { domPassthrough, useTranslate } from '../../../core';
import { Box, Card, Typography } from '../../../core';
import { VStack } from '../../../core';
import { LearningCanvasState, shapeClickCallbacks } from '../atoms/LearningCanvas';
import type { LearningReadout, LearningShape, LearningTracePanel } from '../atoms/LearningCanvas';
import type { UiError } from '../../../core';
import type { CanvasLighting, CanvasPost } from '../../../lib/drawable/scene3dTypes';
import { OrbitalCanvas3D } from '../../../lib/drawable/orbital/OrbitalCanvas3D';
import { OrbitalSceneCanvas } from '../../../lib/drawable/orbital/OrbitalSceneCanvas';
import { cameraConfig } from '../../../lib/drawable/orbital/sceneConfig';
import type { MeshShapeKind } from '../../game/atoms/DrawMesh';

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

export type BiologyStageState = 'pending' | 'active' | 'done';

/** A phase/step chip in a `stages` timeline or ring. */
export interface BiologyStage {
  label: string;
  /** Progress state driving fill/text color (default 'pending'). */
  state?: BiologyStageState;
  /** Overrides the state-derived fill: a tone name, token or literal. */
  color?: string;
}

/** One base pair (rung) of a `helix` ladder. */
export type BiologyHelixRung = {
  /** Base letter on strand A (top). */
  a?: string;
  /** Base letter on strand B (bottom). */
  b?: string;
  /** 'new' renders the rung in the newly-synthesized color (default `accent`); 'open'/'paired' drive strand separation. */
  state?: 'paired' | 'open' | 'new';
  /** Overrides the state-derived rung color. */
  color?: string;
};

/** A DNA double-helix ladder rendered as two strand polylines plus rungs, with an optional unzipped fork. */
export type BiologyHelix = {
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
};

/** One base-pair rung of a 3D `helix3d` ladder. */
export type BiologyHelixRung3D = {
  /** Clickable when present — stamped on this rung's marker sphere. */
  id?: string;
  /** Rung cylinder + marker color: a tone name, token or literal (default `muted`). */
  color?: string;
  /** Marker sphere radius override (e.g. selection enlargement). */
  radius?: number;
  /** Billboard label above the marker. */
  label?: string;
};

/**
 * A 3D DNA double-helix: two beaded backbone strands plus a base-pair rung
 * per index, optionally unwound (replication-fork style) at one end. 3D only.
 * @synonyms DNA double helix, base pairs 3D
 */
export type BiologyHelix3D = {
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
};

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
  /** Painter: 2D raster (default) or 3D mesh scene, both drawn by orbital-canvas. */
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


export const BiologyCanvas: React.FC<BiologyCanvasProps> = ({
  className,
  title,
  width = 600,
  height = 400,
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
  const { t } = useTranslate();
  const config = useMemo<PatternConfig<'biology-canvas'>>(
    () => ({
      type: 'biology-canvas',
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
      nodes,
      edges,
      compartments,
      bands,
      stages,
      stageStyle,
      helix,
      helix3d,
      shapes,
      readouts,
      traces,
      showGrid,
      shadows,
      interactive,
      animate,
    }),
    [width, height, backgroundColor, series, keyMap, keyUpMap, mode, camera, lighting, post, nodes, edges, compartments, bands, stages, stageStyle, helix, helix3d, shapes, readouts, traces, showGrid, shadows, interactive, animate],
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
              pattern="biology-canvas"
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
        <OrbitalSceneCanvas pattern="biology-canvas" config={config} width={width ?? 600} height={height ?? 400} callbacks={callbacks} keyMap={keyMap} keyUpMap={keyUpMap} />
      </VStack>
    </Card>
  );
};
