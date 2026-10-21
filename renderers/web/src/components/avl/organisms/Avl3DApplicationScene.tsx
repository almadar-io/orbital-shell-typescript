'use client';

/**
 * Avl3DApplicationScene - Galaxy view of all orbitals.
 *
 * Positions orbitals on a golden-ratio spiral and renders cross-orbital
 * event wires between them. The 3D equivalent of AvlApplicationScene.
 *
 * @packageDocumentation
 */

import React, { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group } from 'three';
import type { ApplicationLevelData } from '../../../lib/avl-schema-parser';
import { goldenSpiralPositions, forceDirectedPositions } from '../../../lib/avl-3d-layout';
import { Avl3DOrbitalNode } from '../molecules/Avl3DOrbitalNode';
import { Avl3DCrossWire } from '../molecules/Avl3DCrossWire';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface Avl3DApplicationSceneProps {
  /** Parsed application-level data */
  data: ApplicationLevelData;
  /** Click handler for an orbital */
  onOrbitalClick?: (orbitalName: string) => void;
  /** Primary color */
  color?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const Avl3DApplicationScene: React.FC<Avl3DApplicationSceneProps> = ({
  data,
  onOrbitalClick,
}) => {
  const groupRef = useRef<Group>(null);
  const [, setHoverTrigger] = useState(0);

  // U1: Calculate 3D positions using force-directed layout (Gestalt grouping)
  // Connected orbitals cluster together, unconnected repel
  const orbitalPositions = useMemo(() => {
    const baseRadius = Math.max(4, data.orbitals.length * 1.5);

    if (data.crossLinks.length === 0) {
      // No connections: fall back to golden spiral
      return goldenSpiralPositions(data.orbitals.length, baseRadius);
    }

    // Build edge list from cross-links
    const nameToIdx = new Map<string, number>();
    data.orbitals.forEach((o, i) => nameToIdx.set(o.name, i));

    const edges = data.crossLinks
      .map((link) => ({
        from: nameToIdx.get(link.emitterOrbital) ?? -1,
        to: nameToIdx.get(link.listenerOrbital) ?? -1,
      }))
      .filter((e) => e.from >= 0 && e.to >= 0);

    return forceDirectedPositions(data.orbitals.length, edges, baseRadius);
  }, [data.orbitals, data.crossLinks]);

  // Map orbital names to positions for cross-wire lookup
  const positionByName = useMemo(() => {
    const map = new Map<string, [number, number, number]>();
    data.orbitals.forEach((orb, i) => {
      const pos = orbitalPositions[i];
      map.set(orb.name, [pos.x, pos.y, pos.z]);
    });
    return map;
  }, [data.orbitals, orbitalPositions]);

  // Slow ambient rotation
  useFrame((_, delta) => {
    if (!groupRef.current) return;
    groupRef.current.rotation.y += delta * 0.03;
  });

  return (
    <group ref={groupRef}>
      {/* Orbital nodes */}
      {data.orbitals.map((orbital, i) => {
        const pos = orbitalPositions[i];
        return (
          <Avl3DOrbitalNode
            key={orbital.name}
            name={orbital.name}
            entityName={orbital.entityName}
            traitCount={orbital.traitNames.length}
            pageCount={orbital.pageNames.length}
            persistence={orbital.persistence}
            position={[pos.x, pos.y, pos.z]}
            onClick={() => {
              onOrbitalClick?.(orbital.name);
              setHoverTrigger((v) => v + 1);
            }}
          />
        );
      })}

      {/* Cross-orbital event wires */}
      {data.crossLinks.map((link, i) => {
        const fromPos = positionByName.get(link.emitterOrbital);
        const toPos = positionByName.get(link.listenerOrbital);
        if (!fromPos || !toPos) return null;

        return (
          <Avl3DCrossWire
            key={`${link.emitterOrbital}-${link.eventName}-${link.listenerOrbital}-${i}`}
            from={fromPos}
            to={toPos}
            eventName={link.eventName}
          />
        );
      })}
    </group>
  );
};

Avl3DApplicationScene.displayName = 'Avl3DApplicationScene';
