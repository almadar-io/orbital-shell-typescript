'use client';

/**
 * Avl3DEffects - Postprocessing effects and ambient visuals for AVL 3D.
 *
 * Two layers:
 * 1. Ambient visuals (sparkles, starfield) - always rendered via drei
 * 2. Postprocessing (bloom, DOF, vignette) - rendered via @react-three/postprocessing
 *
 * @packageDocumentation
 */

import React, { useMemo } from 'react';
import { EffectComposer, Bloom, DepthOfField, Vignette } from '@react-three/postprocessing';
import { Sparkles, Stars } from '@react-three/drei';
import type { AVL_3D_COLORS } from '../../../lib/avl-3d-layout';
import { useAvl3DPalette } from '../../../providers/avl-3d-context';
import type { ZoomLevel } from '../../../lib/avl-zoom-state';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface Avl3DEffectsProps {
  /** Current zoom level (effects vary by level) */
  level: ZoomLevel;
  /** Enable/disable all effects */
  enabled?: boolean;
}

// ---------------------------------------------------------------------------
// Per-level effect configs
// ---------------------------------------------------------------------------

// Bloom: 60-30-10 rule. Only highly emissive surfaces (entity cores, active states)
// should bloom. Threshold 0.85+ keeps dim surfaces sharp.
const BLOOM_CONFIG: Record<ZoomLevel, { intensity: number; luminanceThreshold: number; luminanceSmoothing: number }> = {
  application: { intensity: 0.4, luminanceThreshold: 0.88, luminanceSmoothing: 0.95 },
  orbital: { intensity: 0.5, luminanceThreshold: 0.85, luminanceSmoothing: 0.9 },
  trait: { intensity: 0.3, luminanceThreshold: 0.92, luminanceSmoothing: 0.9 },
  transition: { intensity: 0.35, luminanceThreshold: 0.9, luminanceSmoothing: 0.9 },
};

// DOF: disabled at galaxy level (orbitals at similar depth get blurred).
// Only used at orbital level where entity core is at center and trait rings are at varying depths.
const DOF_CONFIG: Record<ZoomLevel, { focusDistance: number; focalLength: number; bokehScale: number } | null> = {
  application: null,
  orbital: { focusDistance: 0.02, focalLength: 0.02, bokehScale: 1.5 },
  trait: null,
  transition: null,
};

// Two sparkle layers: cool blue dust + warm gold accents. Colors are resolved
// per render from the AVL_3D_COLORS palette key, never a raw token — Sparkles
// is a three.js material and cannot evaluate `var()`.
const SPARKLE_CONFIGS: Record<ZoomLevel, Array<{ count: number; size: number; speed: number; opacity: number; scale: number; colorKey: keyof typeof AVL_3D_COLORS }>> = {
  application: [
    { count: 60, size: 1.2, speed: 0.2, opacity: 0.35, scale: 35, colorKey: 'sparkle' },
    { count: 15, size: 1.8, speed: 0.1, opacity: 0.2, scale: 25, colorKey: 'sparkleWarm' },
  ],
  orbital: [
    { count: 30, size: 0.8, speed: 0.15, opacity: 0.25, scale: 18, colorKey: 'sparkle' },
    { count: 8, size: 1.2, speed: 0.08, opacity: 0.15, scale: 12, colorKey: 'sparkleWarm' },
  ],
  trait: [
    { count: 15, size: 0.6, speed: 0.1, opacity: 0.2, scale: 12, colorKey: 'sparkle' },
  ],
  transition: [
    { count: 8, size: 0.4, speed: 0.08, opacity: 0.15, scale: 8, colorKey: 'sparkle' },
  ],
};

// Stars config per level (background starfield density)
const STARS_CONFIG: Record<ZoomLevel, { radius: number; count: number; factor: number; fade: boolean }> = {
  application: { radius: 80, count: 3000, factor: 5, fade: true },
  orbital: { radius: 60, count: 1500, factor: 4, fade: true },
  trait: { radius: 40, count: 800, factor: 3, fade: true },
  transition: { radius: 30, count: 400, factor: 2, fade: true },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const Avl3DEffects: React.FC<Avl3DEffectsProps> = ({
  level,
  enabled = true,
}) => {
  const palette = useAvl3DPalette();

  // Memoize stars config to prevent re-renders
  const starsKey = useMemo(() => `stars-${level}`, [level]);

  if (!enabled || !palette) return null;

  const bloom = BLOOM_CONFIG[level];
  const dof = DOF_CONFIG[level];
  const sparkles = SPARKLE_CONFIGS[level];
  const stars = STARS_CONFIG[level];

  return (
    <>
      {/* Deep background starfield */}
      <Stars
        key={starsKey}
        radius={stars.radius}
        count={stars.count}
        factor={stars.factor}
        saturation={0.1}
        fade={stars.fade}
        speed={0.3}
      />

      {/* Ambient sparkle particles (layered: cool blue + warm gold) */}
      {sparkles.map((cfg, i) => (
        <Sparkles
          key={`sparkle-${level}-${i}`}
          count={cfg.count}
          size={cfg.size}
          speed={cfg.speed}
          opacity={cfg.opacity}
          scale={cfg.scale}
          color={palette[cfg.colorKey]}
        />
      ))}

      {/* Postprocessing stack */}
      {dof ? (
        <EffectComposer>
          <Bloom
            intensity={bloom.intensity}
            luminanceThreshold={bloom.luminanceThreshold}
            luminanceSmoothing={bloom.luminanceSmoothing}
            mipmapBlur
          />
          <DepthOfField
            focusDistance={dof.focusDistance}
            focalLength={dof.focalLength}
            bokehScale={dof.bokehScale}
          />
          <Vignette eskil={false} offset={0.2} darkness={0.35} />
        </EffectComposer>
      ) : (
        <EffectComposer>
          <Bloom
            intensity={bloom.intensity}
            luminanceThreshold={bloom.luminanceThreshold}
            luminanceSmoothing={bloom.luminanceSmoothing}
            mipmapBlur
          />
          <Vignette eskil={false} offset={0.2} darkness={0.35} />
        </EffectComposer>
      )}
    </>
  );
};

Avl3DEffects.displayName = 'Avl3DEffects';
