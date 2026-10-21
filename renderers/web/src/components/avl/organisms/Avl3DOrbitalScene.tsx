'use client';

/**
 * Avl3DOrbitalScene - Solar system view of a single orbital.
 *
 * Renders entity core at center, trait orbit rings, and page portals.
 * The 3D equivalent of AvlOrbitalScene.
 *
 * @packageDocumentation
 */

import React, { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group } from 'three';
import { useTranslate } from '../../../core';
import type { OrbitalLevelData } from '../../../lib/avl-schema-parser';
import { useAvl3DPalette } from '../../../providers/avl-3d-context';
import { Avl3DEntityCore } from '../molecules/Avl3DEntityCore';
import { Avl3DLabel } from '../atoms/Avl3DLabel';
import { Avl3DTooltip } from '../atoms/Avl3DTooltip';
import { AVL_INK } from '../../../lib/avl-theme';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface Avl3DOrbitalSceneProps {
  /** Parsed orbital-level data */
  data: OrbitalLevelData;
  /** Click handler for a trait */
  onTraitClick?: (traitName: string) => void;
  /** Currently highlighted trait */
  highlightedTrait?: string | null;
  /** Highlight change handler */
  onTraitHighlight?: (traitName: string | null) => void;
  /** Primary color */
  color?: string;
}

// ---------------------------------------------------------------------------
// Trait Orbit Sub-component
// ---------------------------------------------------------------------------

interface TraitOrbitProps {
  name: string;
  radius: number;
  tilt: number;
  speed: number;
  highlighted: boolean;
  dimmed: boolean;
  stateCount?: number;
  eventCount?: number;
  transitionCount?: number;
  onClick?: () => void;
  onHover?: (hovered: boolean) => void;
}

function TraitOrbit({
  name,
  radius,
  tilt,
  speed,
  highlighted,
  dimmed,
  stateCount = 0,
  eventCount = 0,
  transitionCount = 0,
  onClick,
  onHover,
}: TraitOrbitProps): React.JSX.Element | null {
  const groupRef = useRef<Group>(null);
  const angleRef = useRef(Math.random() * Math.PI * 2);
  const palette = useAvl3DPalette();
  const { t } = useTranslate();

  useFrame((_, delta) => {
    angleRef.current += delta * speed;
    if (!groupRef.current) return;
    // Position the trait marker on the orbit ring
    const x = radius * Math.cos(angleRef.current);
    const flatZ = radius * Math.sin(angleRef.current);
    const y = flatZ * Math.sin(tilt);
    const z = flatZ * Math.cos(tilt);
    groupRef.current.position.set(x, y, z);
  });

  if (!palette) return null;

  const opacity = dimmed ? 0.2 : 0.5;
  const emissiveIntensity = highlighted ? 0.8 : 0.4;

  return (
    <group>
      {/* Orbit ring (torus) */}
      <mesh rotation={[tilt, 0, 0]}>
        <torusGeometry args={[radius, 0.015, 8, 64]} />
        <meshStandardMaterial
          color={palette.traitOrbit}
          emissive={palette.traitOrbit}
          emissiveIntensity={emissiveIntensity}
          transparent
          opacity={opacity}
        />
      </mesh>

      {/* Orbiting trait marker */}
      <group ref={groupRef}>
        <mesh
          onClick={(e) => {
            e.stopPropagation();
            onClick?.();
          }}
          onPointerOver={(e) => {
            e.stopPropagation();
            onHover?.(true);
            document.body.style.cursor = 'pointer';
          }}
          onPointerOut={() => {
            onHover?.(false);
            document.body.style.cursor = 'auto';
          }}
          scale={highlighted ? 1.3 : 1}
        >
          <sphereGeometry args={[0.25, 16, 16]} />
          <meshStandardMaterial
            color={palette.traitOrbit}
            emissive={palette.traitOrbit}
            emissiveIntensity={highlighted ? 1.2 : 0.6}
            transparent
            opacity={dimmed ? 0.3 : 0.9}
          />
        </mesh>

        {/* Trait name label */}
        <Avl3DLabel
          position={[0, 0.5, 0]}
          text={name}
          color={dimmed ? AVL_INK.quiet : AVL_INK.text}
          fontSize={highlighted ? 13 : 11}
        />

        {/* Hover tooltip */}
        {highlighted && (
          <Avl3DTooltip
            position={[0.8, 0.8, 0]}
            title={name}
            accentColor={palette.traitOrbitHighlight}
            rows={[
              { label: t('avl3d.states'), value: String(stateCount) },
              { label: t('avl3d.events'), value: String(eventCount) },
              { label: t('avl3d.transitions'), value: String(transitionCount) },
            ]}
          />
        )}
      </group>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Page Portal Sub-component
// ---------------------------------------------------------------------------

interface PagePortalProps {
  name: string;
  position: [number, number, number];
}

function PagePortal({ name, position }: PagePortalProps): React.JSX.Element | null {
  const palette = useAvl3DPalette();
  if (!palette) return null;

  return (
    <group position={position}>
      {/* V1: Hexagonal prism (portal/gateway shape) */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.35, 0.35, 0.12, 6]} />
        <meshStandardMaterial
          color={palette.pagePortal}
          emissive={palette.pagePortal}
          emissiveIntensity={0.5}
          transparent
          opacity={0.7}
          roughness={0.3}
        />
      </mesh>

      {/* Inner glow */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.25, 0.25, 0.14, 6]} />
        <meshStandardMaterial
          color={palette.pagePortal}
          emissive={palette.pagePortal}
          emissiveIntensity={0.8}
          transparent
          opacity={0.2}
          depthWrite={false}
        />
      </mesh>

      {/* Page name label */}
      <Avl3DLabel
        position={[0, -0.5, 0]}
        text={name}
        color={palette.pagePortal}
        fontSize={9}
      />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const Avl3DOrbitalScene: React.FC<Avl3DOrbitalSceneProps> = ({
  data,
  onTraitClick,
  highlightedTrait,
  onTraitHighlight,
}) => {
  const [localHighlight, setLocalHighlight] = useState<string | null>(null);
  const activeHighlight = highlightedTrait ?? localHighlight;

  // Compute trait orbit parameters
  const traitOrbits = useMemo(() => {
    return data.traits.map((trait, i) => ({
      name: trait.name,
      radius: 3 + i * 1.2,
      tilt: (i * Math.PI) / (data.traits.length + 1) - Math.PI / 4,
      speed: 0.3 - i * 0.04,
      stateCount: trait.stateCount,
      eventCount: trait.eventCount,
      transitionCount: trait.transitionCount,
    }));
  }, [data.traits]);

  // Compute page portal positions (evenly around the outer edge)
  const pagePositions = useMemo((): [number, number, number][] => {
    const outerRadius = 3 + data.traits.length * 1.2 + 1.5;
    return data.pages.map((_, i) => {
      const angle = (2 * Math.PI * i) / data.pages.length - Math.PI / 2;
      return [
        outerRadius * Math.cos(angle),
        0,
        outerRadius * Math.sin(angle),
      ] as [number, number, number];
    });
  }, [data.pages, data.traits.length]);

  return (
    <group>
      {/* Entity core at center */}
      <Avl3DEntityCore
        name={data.entity.name}
        fieldCount={data.entity.fields.length}
        persistence={data.entity.persistence}
        position={[0, 0, 0]}
        fields={data.entity.fields.map((f) => f.type)}
      />

      {/* Trait orbits */}
      {traitOrbits.map((orbit) => (
        <TraitOrbit
          key={orbit.name}
          name={orbit.name}
          radius={orbit.radius}
          tilt={orbit.tilt}
          speed={orbit.speed}
          highlighted={activeHighlight === orbit.name}
          dimmed={activeHighlight !== null && activeHighlight !== orbit.name}
          stateCount={orbit.stateCount}
          eventCount={orbit.eventCount}
          transitionCount={orbit.transitionCount}
          onClick={() => onTraitClick?.(orbit.name)}
          onHover={(h) => {
            const value = h ? orbit.name : null;
            onTraitHighlight?.(value);
            setLocalHighlight(value);
          }}
        />
      ))}

      {/* Page portals */}
      {data.pages.map((page, i) => (
        <PagePortal
          key={page.name}
          name={page.name}
          position={pagePositions[i]}
        />
      ))}
    </group>
  );
};

Avl3DOrbitalScene.displayName = 'Avl3DOrbitalScene';
