'use client';

/**
 * AvlCosmicZoom — Interactive Orbital Visualization
 *
 * V3: Delegates to FlowCanvas. Nodes are live OrbPreview renders
 * of each orbital/transition. Two-level navigation (overview + expanded).
 * Props interface preserved for backward compatibility with callers.
 */

import React from 'react';
import type { OrbitalSchema } from '@almadar/core';
import { FlowCanvas } from './FlowCanvas';
import type { ZoomLevel } from '../../../lib/avl-zoom-state';

// ---------------------------------------------------------------------------
// Props (preserved from V2)
// ---------------------------------------------------------------------------

export interface AvlCosmicZoomProps {
  /** The orbital schema (parsed object or JSON string) */
  schema: OrbitalSchema | string;
  /** CSS class for the outer container */
  className?: string;
  /** Primary color for the visualization */
  color?: string;
  /** Enable animations (default: true) */
  animated?: boolean;
  /** Pre-select an orbital on mount */
  initialOrbital?: string;
  /** Pre-select a trait on mount */
  initialTrait?: string;
  /** Callback when zoom level changes */
  onZoomChange?: (level: ZoomLevel, context: { orbital?: string; trait?: string }) => void;
  /** Container width */
  width?: number | string;
  /** Container height */
  height?: number | string;
  /** Coverage data for verification overlay */
  stateCoverage?: Record<string, 'covered' | 'uncovered' | 'partial'>;
  /** Dynamic focus target. Changes animate the zoom to the specified orbital/trait. */
  focusTarget?: { type: 'orbital' | 'trait'; name: string };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const AvlCosmicZoom: React.FC<AvlCosmicZoomProps> = (props) => {
  return (
    <FlowCanvas
      schema={props.schema}
      className={props.className}
      width={props.width}
      height={props.height ?? 400}
      initialOrbital={props.initialOrbital}
    />
  );
};

AvlCosmicZoom.displayName = 'AvlCosmicZoom';
