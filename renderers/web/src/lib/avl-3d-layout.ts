/**
 * avl-3d-layout.ts
 *
 * Pure math utilities for 3D positioning of AVL visualization nodes.
 * The 3D equivalent of avl-layout.ts (2D positioning helpers).
 *
 * @packageDocumentation
 */

import { avlBlend, AVL_INK } from './avl-theme';
import { QuadraticBezierCurve3, Vector3 } from 'three';
import { OPERATOR_CATEGORY_COLORS, EFFECT_CATEGORY_COLORS, effectCategoryOf, type EffectCategory } from './avl-theme';
import { EntityPersistenceSchema, type EntityPersistence } from '@almadar/core';
import type { OperatorCategory } from '@almadar/std';
import { getStdOperatorMeta } from '@almadar/std/registry';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Position3D {
  x: number;
  y: number;
  z: number;
}

export interface ExprTreeNode3D {
  label: string;
  type: 'operator' | 'literal' | 'binding';
  children?: ExprTreeNode3D[];
}

export interface TreeLayoutResult {
  node: ExprTreeNode3D;
  position: Position3D;
}

// ---------------------------------------------------------------------------
// Color Palette (from design doc)
// ---------------------------------------------------------------------------

type OperatorPaletteKey = `op:${OperatorCategory}`;

function operatorPaletteKey(category: OperatorCategory): OperatorPaletteKey {
  return `op:${category}`;
}

function operatorCategoryPalette(): Record<OperatorPaletteKey, string> {
  const out = {} as Record<OperatorPaletteKey, string>;
  for (const [category, color] of Object.entries(OPERATOR_CATEGORY_COLORS) as Array<[OperatorCategory, string]>) out[operatorPaletteKey(category)] = color;
  return out;
}

/**
 * Theme roles for the 3D scenes. three.js cannot evaluate CSS, so scenes read
 * these through `useAvl3DPalette()` (resolved against the active theme).
 */
export const AVL_3D_COLORS = {
  orbitalSphere: 'var(--color-card)',
  orbitalRim: 'var(--color-info)',
  entityCore: 'var(--color-warning)',
  entityCoreGlow: avlBlend('var(--color-warning)', 70, 'var(--color-background)'),
  traitOrbit: 'var(--color-info)',
  traitOrbitHighlight: 'var(--color-primary)',
  stateIdle: 'var(--color-muted)',
  stateEdge: 'var(--color-info)',
  stateActive: 'var(--color-primary)',
  transitionArc: 'var(--color-muted-foreground)',
  transitionArcHover: 'var(--color-primary)',
  guardPass: 'var(--color-success)',
  guardFail: 'var(--color-error)',
  crossWire: 'var(--color-accent)',
  crossWireGlow: avlBlend('var(--color-accent)', 70, 'var(--color-background)'),
  pagePortal: 'var(--color-success)',
  background: 'var(--color-background)',
  backgroundSurface: 'var(--color-card)',
  fog: 'var(--color-background)',
  sparkle: 'var(--color-info)',
  sparkleWarm: 'var(--color-warning)',
  // Entity persistence badge (Avl3DEntityCore ring + micro-icons)
  persistencePersistent: 'var(--color-info)',
  persistenceRuntime: 'var(--color-success)',
  persistenceUnknown: 'var(--color-muted-foreground)',
  // Expression tree (Avl3DExprTree): operator categories, bindings, literals
  ...operatorCategoryPalette(),
  exprOperatorUnknown: 'var(--color-muted-foreground)',
  exprBinding: 'var(--color-accent)',
  exprLiteral: 'var(--color-muted-foreground)',
  // Effect category (Avl3DTransitionArc micro-icons)
  effectUi: EFFECT_CATEGORY_COLORS.ui.color,
  effectData: EFFECT_CATEGORY_COLORS.data.color,
  effectCommunication: EFFECT_CATEGORY_COLORS.communication.color,
  effectLifecycle: EFFECT_CATEGORY_COLORS.lifecycle.color,
  effectControl: EFFECT_CATEGORY_COLORS.control.color,
  effectAsync: EFFECT_CATEGORY_COLORS.async.color,
  effectCompute: EFFECT_CATEGORY_COLORS.compute.color,
  effectSystem: EFFECT_CATEGORY_COLORS.system.color,
  effectUnknown: 'var(--color-muted-foreground)',
  // Misc mesh accents
  fieldParticle: 'var(--color-foreground)',
  lightAmbient: 'var(--color-info)',
  lightDirectional: avlBlend('var(--color-info)', 50, AVL_INK.onFocus),
  lightFill: avlBlend('var(--color-info)', 70, AVL_INK.canvas),
} as const;

// ---------------------------------------------------------------------------
// Palette key lookups — pure, so a switch on operator/effect/persistence
// vocabulary is unit-testable without mounting a scene.
// ---------------------------------------------------------------------------

const PERSISTENCE_PALETTE_KEY: Record<EntityPersistence, keyof typeof AVL_3D_COLORS> = {
  persistent: 'persistencePersistent',
  runtime: 'persistenceRuntime',
};

/** Palette key for an entity's persistence badge; a value core does not declare gets the "unknown" key. */
export function persistencePaletteKey(persistence: string): keyof typeof AVL_3D_COLORS {
  const parsed = EntityPersistenceSchema.safeParse(persistence);
  return parsed.success ? PERSISTENCE_PALETTE_KEY[parsed.data] : 'persistenceUnknown';
}

/** Palette key for an expression-tree operator: its std operator category; a non-operator label gets "unknown". */
export function exprOperatorPaletteKey(label: string): keyof typeof AVL_3D_COLORS {
  const meta = getStdOperatorMeta(label);
  return meta ? operatorPaletteKey(meta.category) : 'exprOperatorUnknown';
}

const EFFECT_CATEGORY_PALETTE_KEY: Record<EffectCategory, keyof typeof AVL_3D_COLORS> = {
  ui: 'effectUi',
  data: 'effectData',
  communication: 'effectCommunication',
  lifecycle: 'effectLifecycle',
  control: 'effectControl',
  async: 'effectAsync',
  compute: 'effectCompute',
  system: 'effectSystem',
};

/** Palette key for an effect's arc/micro-icon color; an effect core does not declare gets "unknown". */
export function effectTypePaletteKey(type: string): keyof typeof AVL_3D_COLORS {
  const category = effectCategoryOf(type);
  return category ? EFFECT_CATEGORY_PALETTE_KEY[category] : 'effectUnknown';
}

// ---------------------------------------------------------------------------
// Golden angle spiral (Application level - galaxy view, fallback)
// ---------------------------------------------------------------------------

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // ~137.508 degrees in radians

/**
 * Positions N nodes on a golden-ratio spiral in the XZ plane (y=0).
 * Used as initial positions for the force-directed layout.
 */
export function goldenSpiralPositions(count: number, baseRadius: number): Position3D[] {
  if (count === 0) return [];
  if (count === 1) return [{ x: 0, y: 0, z: 0 }];

  const positions: Position3D[] = [];
  for (let i = 0; i < count; i++) {
    const angle = i * GOLDEN_ANGLE;
    const r = baseRadius * Math.sqrt(i / count);
    positions.push({
      x: r * Math.cos(angle),
      y: 0,
      z: r * Math.sin(angle),
    });
  }
  return positions;
}

// ---------------------------------------------------------------------------
// Force-directed layout (U1: Gestalt grouping)
// ---------------------------------------------------------------------------

interface ForceEdge {
  from: number;
  to: number;
}

/**
 * Runs a simple force-directed simulation to cluster connected nodes.
 * Connected nodes attract, all nodes repel. Runs for a fixed number of iterations.
 *
 * @param count Number of nodes
 * @param edges Connections between nodes (indices)
 * @param baseRadius Approximate spread radius
 * @param iterations Simulation steps (default 80)
 */
export function forceDirectedPositions(
  count: number,
  edges: ForceEdge[],
  baseRadius: number,
  iterations: number = 80,
): Position3D[] {
  if (count === 0) return [];
  if (count === 1) return [{ x: 0, y: 0, z: 0 }];

  // Initialize with spiral positions
  const positions = goldenSpiralPositions(count, baseRadius);

  const repulsionStrength = baseRadius * baseRadius * 0.5;
  const attractionStrength = 0.15;
  const damping = 0.85;

  const velocities: Position3D[] = positions.map(() => ({ x: 0, y: 0, z: 0 }));

  for (let iter = 0; iter < iterations; iter++) {
    // Repulsion between all pairs
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        const dx = positions[i].x - positions[j].x;
        const dz = positions[i].z - positions[j].z;
        const distSq = dx * dx + dz * dz + 0.01;
        const force = repulsionStrength / distSq;
        const dist = Math.sqrt(distSq);
        const fx = (dx / dist) * force;
        const fz = (dz / dist) * force;

        velocities[i].x += fx;
        velocities[i].z += fz;
        velocities[j].x -= fx;
        velocities[j].z -= fz;
      }
    }

    // Attraction along edges
    for (const edge of edges) {
      const dx = positions[edge.to].x - positions[edge.from].x;
      const dz = positions[edge.to].z - positions[edge.from].z;
      const dist = Math.sqrt(dx * dx + dz * dz + 0.01);
      const force = dist * attractionStrength;
      const fx = (dx / dist) * force;
      const fz = (dz / dist) * force;

      velocities[edge.from].x += fx;
      velocities[edge.from].z += fz;
      velocities[edge.to].x -= fx;
      velocities[edge.to].z -= fz;
    }

    // Apply velocities with damping
    for (let i = 0; i < count; i++) {
      positions[i].x += velocities[i].x * 0.1;
      positions[i].z += velocities[i].z * 0.1;
      velocities[i].x *= damping;
      velocities[i].z *= damping;
    }
  }

  // Center the layout
  let cx = 0, cz = 0;
  for (const p of positions) { cx += p.x; cz += p.z; }
  cx /= count; cz /= count;
  for (const p of positions) { p.x -= cx; p.z -= cz; }

  return positions;
}

// ---------------------------------------------------------------------------
// Fibonacci sphere (Trait level - state machine)
// ---------------------------------------------------------------------------

/**
 * Distributes N points on a sphere surface using Fibonacci lattice.
 * Produces near-uniform spacing regardless of count.
 */
export function fibonacciSpherePositions(count: number, radius: number): Position3D[] {
  if (count === 0) return [];
  if (count === 1) return [{ x: 0, y: 0, z: 0 }];

  const positions: Position3D[] = [];
  for (let i = 0; i < count; i++) {
    const y = 1 - (2 * i) / (count - 1); // -1 to 1
    const radiusAtY = Math.sqrt(1 - y * y);
    const theta = GOLDEN_ANGLE * i;
    positions.push({
      x: radius * radiusAtY * Math.cos(theta),
      y: radius * y,
      z: radius * radiusAtY * Math.sin(theta),
    });
  }
  return positions;
}

// ---------------------------------------------------------------------------
// Orbit ring (Orbital level - trait orbits)
// ---------------------------------------------------------------------------

/**
 * Evenly spaces N points on a tilted ring (elliptical orbit).
 * `tilt` is the ring's inclination in radians relative to the XZ plane.
 */
export function orbitRingPositions(
  count: number,
  radius: number,
  tilt: number,
): Position3D[] {
  if (count === 0) return [];

  const positions: Position3D[] = [];
  const step = (2 * Math.PI) / count;

  for (let i = 0; i < count; i++) {
    const angle = i * step;
    const x = radius * Math.cos(angle);
    const flatZ = radius * Math.sin(angle);
    // Apply tilt: rotate around the X-axis
    const y = flatZ * Math.sin(tilt);
    const z = flatZ * Math.cos(tilt);
    positions.push({ x, y, z });
  }
  return positions;
}

// ---------------------------------------------------------------------------
// 3D arc curve (transitions, cross-wires)
// ---------------------------------------------------------------------------

/**
 * Creates a QuadraticBezierCurve3 between two 3D points with a control
 * point offset perpendicular to the from-to line. The offset direction
 * is computed in 3D using a cross product with the up vector.
 */
export function arcCurve3D(
  from: [number, number, number],
  to: [number, number, number],
  offset: number,
): QuadraticBezierCurve3 {
  const start = new Vector3(...from);
  const end = new Vector3(...to);
  const mid = new Vector3().addVectors(start, end).multiplyScalar(0.5);

  // Direction from start to end
  const dir = new Vector3().subVectors(end, start).normalize();
  // Up vector
  const up = new Vector3(0, 1, 0);
  // Perpendicular direction
  const perp = new Vector3().crossVectors(dir, up).normalize();

  // If dir is parallel to up, use a different reference
  if (perp.length() < 0.001) {
    perp.crossVectors(dir, new Vector3(1, 0, 0)).normalize();
  }

  // Offset the midpoint
  const control = mid.clone().add(perp.multiplyScalar(offset));
  // Also lift control point slightly for visual clarity
  control.y += Math.abs(offset) * 0.3;

  return new QuadraticBezierCurve3(start, control, end);
}

// ---------------------------------------------------------------------------
// Self-loop curve (self-transitions)
// ---------------------------------------------------------------------------

/**
 * Creates a loop curve above a point for self-transitions.
 */
export function selfLoopCurve3D(
  position: [number, number, number],
  loopRadius: number,
): QuadraticBezierCurve3 {
  const base = new Vector3(...position);
  const start = base.clone().add(new Vector3(-loopRadius * 0.3, 0, 0));
  const end = base.clone().add(new Vector3(loopRadius * 0.3, 0, 0));
  const control = base.clone().add(new Vector3(0, loopRadius, 0));

  return new QuadraticBezierCurve3(start, control, end);
}

// ---------------------------------------------------------------------------
// 3D tree layout (Transition level - expression tree)
// ---------------------------------------------------------------------------

/**
 * Recursively positions an expression tree in 3D space.
 * Root at origin, children spread horizontally, depth goes downward (negative Y).
 */
export function treeLayout3D(
  node: ExprTreeNode3D,
  origin: Position3D,
  horizontalSpacing: number,
  verticalSpacing: number = 2,
): TreeLayoutResult[] {
  const results: TreeLayoutResult[] = [];

  function layoutNode(
    n: ExprTreeNode3D,
    pos: Position3D,
    depth: number,
  ): void {
    results.push({ node: n, position: pos });

    if (!n.children || n.children.length === 0) return;

    const childCount = n.children.length;
    const totalWidth = (childCount - 1) * horizontalSpacing / (depth + 1);
    const startX = pos.x - totalWidth / 2;

    for (let i = 0; i < childCount; i++) {
      const childPos: Position3D = {
        x: startX + (i * totalWidth) / Math.max(childCount - 1, 1),
        y: pos.y - verticalSpacing,
        z: pos.z,
      };
      layoutNode(n.children[i], childPos, depth + 1);
    }
  }

  layoutNode(node, origin, 0);
  return results;
}

// ---------------------------------------------------------------------------
// Camera positions per zoom level
// ---------------------------------------------------------------------------

export const CAMERA_POSITIONS = {
  application: { position: [0, 20, 30] as [number, number, number], target: [0, 0, 0] as [number, number, number] },
  orbital: { position: [0, 8, 12] as [number, number, number], target: [0, 0, 0] as [number, number, number] },
  trait: { position: [0, 6, 10] as [number, number, number], target: [0, 0, 0] as [number, number, number] },
  transition: { position: [0, 4, 8] as [number, number, number], target: [0, 0, 0] as [number, number, number] },
} as const;
