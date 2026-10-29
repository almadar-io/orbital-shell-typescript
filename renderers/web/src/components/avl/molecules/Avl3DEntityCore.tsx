'use client';

/**
 * Avl3DEntityCore - Glowing entity center for the orbital solar system view.
 *
 * Renders an icosahedron with gold emissive glow, surrounded by
 * field indicator particles and a point light.
 *
 * @packageDocumentation
 */

import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Mesh } from 'three';
import { AVL_3D_COLORS, persistencePaletteKey } from '../../../lib/avl-3d-layout';
import { useAvl3DPalette } from '../../../providers/avl-3d-context';
import { useTranslate, usePrefersReducedMotion } from '../../../core';
import { Avl3DLabel } from '../atoms/Avl3DLabel';
import { AVL_INK } from '../../../lib/avl-theme';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface Avl3DEntityCoreProps {
  /** Entity name */
  name: string;
  /** Number of fields */
  fieldCount: number;
  /** Persistence type */
  persistence: string;
  /** 3D position [x, y, z] */
  position: [number, number, number];
  /** Field type strings for V5 shape encoding (optional, falls back to spheres) */
  fields?: string[];
  /** Color override */
  color?: string;
  /** CSS class for label */
  className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate field indicator positions on an icosahedron surface */
function fieldPositions(count: number, radius: number): [number, number, number][] {
  const positions: [number, number, number][] = [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  for (let i = 0; i < Math.min(count, 12); i++) {
    const y = 1 - (2 * i) / Math.max(count - 1, 1);
    const r = Math.sqrt(1 - y * y);
    const theta = goldenAngle * i;
    positions.push([
      radius * r * Math.cos(theta),
      radius * y,
      radius * r * Math.sin(theta),
    ]);
  }
  return positions;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const Avl3DEntityCore: React.FC<Avl3DEntityCoreProps> = ({
  name,
  fieldCount,
  persistence,
  position,
  fields,
}) => {
  const coreRef = useRef<Mesh>(null);
  const palette = useAvl3DPalette();
  const { t } = useTranslate();

  // Slow rotation for visual interest
  const reducedMotion = usePrefersReducedMotion();
  useFrame((_, delta) => {
    if (!coreRef.current || reducedMotion) return;
    coreRef.current.rotation.y += delta * 0.3;
    coreRef.current.rotation.x += delta * 0.1;
  });

  if (!palette) return null;

  const fieldPos = fieldPositions(fieldCount, 1.4);
  const pColor = palette[persistencePaletteKey(persistence)];

  return (
    <group position={position}>
      {/* Core icosahedron */}
      <mesh ref={coreRef}>
        <icosahedronGeometry args={[1, 2]} />
        <meshStandardMaterial
          color={palette.entityCore}
          emissive={palette.entityCoreGlow}
          emissiveIntensity={2.0}
          roughness={0.15}
          metalness={0.85}
        />
      </mesh>

      {/* Inner glow shell (warm halo) */}
      <mesh scale={1.2}>
        <sphereGeometry args={[1, 24, 24]} />
        <meshStandardMaterial
          color={palette.entityCoreGlow}
          emissive={palette.entityCoreGlow}
          emissiveIntensity={0.6}
          transparent
          opacity={0.1}
          depthWrite={false}
        />
      </mesh>

      {/* Outer atmospheric glow */}
      <mesh scale={1.6}>
        <sphereGeometry args={[1, 16, 16]} />
        <meshStandardMaterial
          color={palette.entityCore}
          emissive={palette.entityCore}
          emissiveIntensity={0.2}
          transparent
          opacity={0.04}
          depthWrite={false}
        />
      </mesh>

      {/* Point light for warm glow on nearby objects */}
      <pointLight
        color={palette.entityCoreGlow}
        intensity={2.5}
        distance={10}
        decay={2}
      />

      {/* V5: Field indicator particles with type-specific shapes */}
      {fieldPos.map((pos, i) => {
        const fieldType = fields?.[i];
        return (
          <mesh key={i} position={pos} scale={0.08} rotation={[Math.PI / 6, Math.PI / 4, 0]}>
            {fieldType === 'number' ? (
              <tetrahedronGeometry args={[1, 0]} />
            ) : fieldType === 'boolean' ? (
              <boxGeometry args={[1.2, 1.2, 1.2]} />
            ) : fieldType === 'date' ? (
              <octahedronGeometry args={[1, 0]} />
            ) : fieldType === 'enum' ? (
              <torusGeometry args={[0.8, 0.3, 6, 12]} />
            ) : fieldType === 'object' ? (
              <dodecahedronGeometry args={[1, 0]} />
            ) : fieldType === 'array' ? (
              <cylinderGeometry args={[0.8, 0.8, 1.5, 6]} />
            ) : (
              // string (default): sphere
              <sphereGeometry args={[1, 8, 8]} />
            )}
            <meshStandardMaterial
              color={palette.fieldParticle}
              emissive={palette.fieldParticle}
              emissiveIntensity={0.8}
              transparent
              opacity={0.7}
            />
          </mesh>
        );
      })}

      {/* V2: Persistence-specific ring encoding */}
      {persistence === 'singleton' ? (
        // Singleton: double concentric rings (thick outer + thin inner)
        <>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[1.6, 0.04, 8, 64]} />
            <meshStandardMaterial color={pColor} emissive={pColor} emissiveIntensity={0.6} transparent opacity={0.6} />
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[1.4, 0.02, 8, 64]} />
            <meshStandardMaterial color={pColor} emissive={pColor} emissiveIntensity={0.4} transparent opacity={0.4} />
          </mesh>
        </>
      ) : persistence === 'runtime' ? (
        // Runtime: segmented ring (8 arc segments with gaps)
        <>
          {Array.from({ length: 8 }).map((_, i) => {
            const angle = (i / 8) * Math.PI * 2;
            const x = 1.6 * Math.cos(angle);
            const z = 1.6 * Math.sin(angle);
            return (
              <mesh key={i} position={[x, 0, z]} rotation={[Math.PI / 2, 0, angle]}>
                <torusGeometry args={[0.25, 0.025, 6, 12, Math.PI * 0.7]} />
                <meshStandardMaterial color={pColor} emissive={pColor} emissiveIntensity={0.6} transparent opacity={0.6} />
              </mesh>
            );
          })}
        </>
      ) : persistence === 'instance' ? (
        // Instance: dotted ring (small spheres in a circle)
        <>
          {Array.from({ length: 16 }).map((_, i) => {
            const angle = (i / 16) * Math.PI * 2;
            const x = 1.6 * Math.cos(angle);
            const z = 1.6 * Math.sin(angle);
            return (
              <mesh key={i} position={[x, 0, z]} scale={0.04}>
                <sphereGeometry args={[1, 6, 6]} />
                <meshStandardMaterial color={pColor} emissive={pColor} emissiveIntensity={0.8} />
              </mesh>
            );
          })}
        </>
      ) : (
        // Persistent (default): solid torus ring
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1.6, 0.03, 8, 64]} />
          <meshStandardMaterial color={pColor} emissive={pColor} emissiveIntensity={0.6} transparent opacity={0.6} />
        </mesh>
      )}

      {/* Entity name label */}
      <Avl3DLabel
        position={[0, -1.8, 0]}
        text={name}
        color={AVL_3D_COLORS.entityCore}
        fontSize={14}
      />

      {/* Field count sublabel */}
      <Avl3DLabel
        position={[0, -2.3, 0]}
        text={t(fieldCount === 1 ? 'avl3d.fieldCountOne' : 'avl3d.fieldCountOther', { count: fieldCount })}
        color={AVL_INK.quiet}
        fontSize={10}
      />
    </group>
  );
};

Avl3DEntityCore.displayName = 'Avl3DEntityCore';
