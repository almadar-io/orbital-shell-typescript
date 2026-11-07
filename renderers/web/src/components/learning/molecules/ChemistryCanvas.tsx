'use client';

/**
 * ChemistryCanvas
 *
 * A field-scoped learning molecule for chemistry: atoms, bonds, arrows, containers and an equation in 2D, or a 3D
 * scene, mapped and drawn by orbital-canvas.
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
export type ChemistryLatticeSite = {
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
};

/** A bond rule generating one cylinder per valid `from`→`to` site-instance pair. */
export type ChemistryLatticeBond = {
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
};

/**
 * A 3D crystal lattice (simple cubic, BCC, FCC, rock salt, diamond, ...)
 * generated procedurally from a fractional basis + bond rules into a block
 * centered on the origin. 3D only.
 * @synonyms crystal lattice, unit cell, BCC FCC
 */
export type ChemistryLattice3D = {
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
};

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
  /** Painter: 2D raster (default) or 3D mesh scene, both drawn by orbital-canvas. */
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


export const ChemistryCanvas: React.FC<ChemistryCanvasProps> = ({
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
  const { t } = useTranslate();
  const config = useMemo<PatternConfig<'chemistry-canvas'>>(
    () => ({
      type: 'chemistry-canvas',
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
      atoms,
      bonds,
      arrows,
      bondStyle,
      containers,
      equation,
      equationColor,
      lattice3d,
      shapes,
      readouts,
      traces,
      showGrid,
      shadows,
      interactive,
      animate,
    }),
    [width, height, backgroundColor, series, keyMap, keyUpMap, mode, camera, lighting, post, atoms, bonds, arrows, bondStyle, containers, equation, equationColor, lattice3d, shapes, readouts, traces, showGrid, shadows, interactive, animate],
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
              pattern="chemistry-canvas"
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
        <OrbitalSceneCanvas pattern="chemistry-canvas" config={config} width={width ?? 600} height={height ?? 400} callbacks={callbacks} keyMap={keyMap} keyUpMap={keyUpMap} />
      </VStack>
    </Card>
  );
};
