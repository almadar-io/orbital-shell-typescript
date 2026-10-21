'use client';

/**
 * Avl3DCrossWire - Inter-orbital event connection tube.
 *
 * Renders a curved tube between two orbitals representing
 * a cross-orbital emit/listen event connection.
 *
 * @packageDocumentation
 */

import React, { useMemo } from 'react';
import { arcCurve3D } from '../../../lib/avl-3d-layout';
import { useAvl3DPalette } from '../../../providers/avl-3d-context';
import { Avl3DLabel } from '../atoms/Avl3DLabel';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface Avl3DCrossWireProps {
  /** Start position [x, y, z] */
  from: [number, number, number];
  /** End position [x, y, z] */
  to: [number, number, number];
  /** Event name to display */
  eventName: string;
  /** Wire color override */
  color?: string;
  /** CSS class */
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const Avl3DCrossWire: React.FC<Avl3DCrossWireProps> = ({
  from,
  to,
  eventName,
  color,
}) => {
  const palette = useAvl3DPalette();
  const { tubeArgs, midpoint } = useMemo(() => {
    const curve = arcCurve3D(from, to, 2);
    const mid = curve.getPoint(0.5);
    return {
      tubeArgs: [curve, 32, 0.03, 8, false] as const,
      midpoint: [mid.x, mid.y, mid.z] as [number, number, number],
    };
  }, [from, to]);

  if (!palette) return null;

  const wireColor = color ?? palette.crossWire;

  return (
    <group>
      {/* Tube geometry along curve */}
      <mesh>
        <tubeGeometry args={[tubeArgs[0], tubeArgs[1], tubeArgs[2], tubeArgs[3], tubeArgs[4]]} />
        <meshStandardMaterial
          color={wireColor}
          emissive={wireColor}
          emissiveIntensity={0.4}
          transparent
          opacity={0.6}
          roughness={0.5}
        />
      </mesh>

      {/* Event label at midpoint */}
      <Avl3DLabel
        position={midpoint}
        text={eventName}
        color={wireColor}
        fontSize={9}
      />
    </group>
  );
};

Avl3DCrossWire.displayName = 'Avl3DCrossWire';
