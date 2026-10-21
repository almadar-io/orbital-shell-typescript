'use client';

/**
 * Avl3DOrbitalNode - Orbital node for the galaxy view.
 *
 * Shape: TORUS (ring) with entity nucleus floating inside.
 * The ring shape literally represents "orbital" and is visually
 * distinct from all other AVL primitives.
 *
 * @packageDocumentation
 */

import React, { useRef, useState, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { MathUtils, type Group } from 'three';
import { AVL_3D_COLORS } from '../../../lib/avl-3d-layout';
import { useAvl3DPalette } from '../../../providers/avl-3d-context';
import { useTranslate } from '../../../core';
import { Avl3DLabel } from '../atoms/Avl3DLabel';
import { Avl3DTooltip } from '../atoms/Avl3DTooltip';
import { AVL_INK } from '../../../lib/avl-theme';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface Avl3DOrbitalNodeProps {
  /** Orbital name */
  name: string;
  /** Entity name */
  entityName: string;
  /** Number of traits (affects ring size and scale) */
  traitCount: number;
  /** Number of pages (affects glow brightness) */
  pageCount?: number;
  /** Entity persistence type */
  persistence?: string;
  /** 3D position [x, y, z] */
  position: [number, number, number];
  /** Click handler */
  onClick?: () => void;
  /** CSS class for label */
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const Avl3DOrbitalNode: React.FC<Avl3DOrbitalNodeProps> = ({
  name,
  entityName,
  traitCount,
  pageCount = 0,
  persistence = 'persistent',
  position,
  onClick,
}) => {
  const groupRef = useRef<Group>(null);
  const [hovered, setHovered] = useState(false);
  const palette = useAvl3DPalette();
  const { t } = useTranslate();

  // U2: Wider scale range (0.6 to 3.0) for stronger visual hierarchy
  const scale = useMemo(() => 0.6 + Math.min(traitCount, 8) * 0.3, [traitCount]);

  // Smooth scale + rotation animation
  const currentScale = useRef(scale);
  const targetScale = hovered ? scale * 1.06 : scale;

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    // Gentle rotation (faster on hover)
    groupRef.current.rotation.y += delta * (hovered ? 0.4 : 0.2);
    groupRef.current.rotation.x += delta * 0.05;
    // Smooth scale interpolation (B4: spring-like feel)
    currentScale.current = MathUtils.damp(currentScale.current, targetScale, 6, delta);
  });

  // U2: Brightness scales with page count (more pages = more prominent)
  const baseBrightness = 0.3 + Math.min(pageCount, 5) * 0.05;
  const emissiveIntensity = hovered ? 0.8 : baseBrightness;

  if (!palette) return null;

  return (
    <group position={position}>
      {/* Outer glow shell */}
      <mesh scale={scale * 1.3}>
        <sphereGeometry args={[1, 16, 16]} />
        <meshStandardMaterial
          color={palette.orbitalRim}
          emissive={palette.orbitalRim}
          emissiveIntensity={hovered ? 0.2 : 0.06}
          transparent
          opacity={hovered ? 0.08 : 0.03}
          depthWrite={false}
        />
      </mesh>

      {/* Main torus (the orbital ring) */}
      <group ref={groupRef}>
        <mesh
          onClick={(e) => {
            e.stopPropagation();
            onClick?.();
          }}
          onPointerOver={(e) => {
            e.stopPropagation();
            setHovered(true);
            document.body.style.cursor = 'pointer';
          }}
          onPointerOut={() => {
            setHovered(false);
            document.body.style.cursor = 'auto';
          }}
          scale={currentScale.current}
          rotation={[Math.PI / 4, 0, 0]}
        >
          <torusGeometry args={[1, 0.18, 24, 64]} />
          <meshStandardMaterial
            color={palette.orbitalSphere}
            emissive={palette.orbitalRim}
            emissiveIntensity={emissiveIntensity}
            roughness={0.2}
            metalness={0.7}
          />
        </mesh>

        {/* Second thinner ring (crossed, adds depth) */}
        <mesh
          scale={scale * 0.9}
          rotation={[Math.PI / 2 + 0.3, Math.PI / 5, 0]}
        >
          <torusGeometry args={[1, 0.06, 12, 64]} />
          <meshStandardMaterial
            color={palette.traitOrbit}
            emissive={palette.traitOrbit}
            emissiveIntensity={0.25}
            transparent
            opacity={0.4}
          />
        </mesh>
      </group>

      {/* Entity nucleus (icosahedron at center) */}
      <mesh scale={scale * 0.25}>
        <icosahedronGeometry args={[1, 1]} />
        <meshStandardMaterial
          color={palette.entityCore}
          emissive={palette.entityCoreGlow}
          emissiveIntensity={2.0}
          roughness={0.1}
        />
      </mesh>

      {/* Nucleus point light */}
      <pointLight
        color={palette.entityCoreGlow}
        intensity={0.5}
        distance={3}
        decay={2}
      />

      {/* Label above */}
      <Avl3DLabel
        position={[0, scale + 0.6, 0]}
        text={name}
        color={AVL_INK.text}
        fontSize={hovered ? 14 : 12}
      />

      {/* Entity sublabel */}
      <Avl3DLabel
        position={[0, -(scale + 0.4), 0]}
        text={entityName}
        color={AVL_INK.quiet}
        fontSize={10}
      />

      {/* Hover tooltip with orbital details */}
      {hovered && (
        <Avl3DTooltip
          position={[scale + 1.2, 0.3, 0]}
          title={name}
          accentColor={AVL_3D_COLORS.orbitalRim}
          rows={[
            { label: t('avl.entity'), value: entityName },
            { label: t('avl.glyph.persistence'), value: persistence },
            { label: t('avl.traits'), value: String(traitCount) },
            { label: t('avl3d.pages'), value: String(pageCount) },
          ]}
        />
      )}
    </group>
  );
};

Avl3DOrbitalNode.displayName = 'Avl3DOrbitalNode';
