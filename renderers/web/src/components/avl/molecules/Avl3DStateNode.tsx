'use client';

/**
 * Avl3DStateNode - State node in the 3D state machine view.
 *
 * Shape: ROUNDED BOX (matches the 2D rounded rectangle).
 * Visually distinct from orbital torus, entity icosahedron, guard octahedron.
 *
 * V3 fix: initial = green arrow cone offset to left, terminal = red stop octahedron offset to right.
 *
 * @packageDocumentation
 */

import React, { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { MathUtils } from 'three';
import { RoundedBox } from '@react-three/drei';
import { useTranslate } from '../../../core';
import { AVL_3D_COLORS } from '../../../lib/avl-3d-layout';
import { useAvl3DPalette } from '../../../providers/avl-3d-context';
import { Avl3DLabel } from '../atoms/Avl3DLabel';
import { Avl3DTooltip } from '../atoms/Avl3DTooltip';
import { AVL_INK } from '../../../lib/avl-theme';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface Avl3DStateNodeProps {
  /** State name */
  name: string;
  /** Whether this is the initial state */
  isInitial?: boolean;
  /** Whether this is a terminal state */
  isTerminal?: boolean;
  /** 3D position [x, y, z] */
  position: [number, number, number];
  /** Whether this state is currently active */
  active?: boolean;
  /** Click handler */
  onClick?: () => void;
  /** Number of incoming transitions */
  incomingCount?: number;
  /** Number of outgoing transitions */
  outgoingCount?: number;
  /** Color override */
  color?: string;
  /** CSS class for label */
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const Avl3DStateNode: React.FC<Avl3DStateNodeProps> = ({
  name,
  isInitial = false,
  isTerminal = false,
  position,
  active = false,
  incomingCount = 0,
  outgoingCount = 0,
  onClick,
}) => {
  const [hovered, setHovered] = useState(false);
  const palette = useAvl3DPalette();
  const { t } = useTranslate();

  const targetScale = hovered ? 1.08 : 1;
  const currentScale = useRef(1);
  useFrame((_, delta) => {
    currentScale.current = MathUtils.damp(currentScale.current, targetScale, 6, delta);
  });
  const scale = currentScale.current;

  if (!palette) return null;

  const baseColor = active ? palette.stateActive : palette.stateIdle;
  const emissiveColor = active ? palette.stateActive : palette.stateEdge;
  const emissiveIntensity = active ? 2.0 : hovered ? 0.8 : 0.3;

  return (
    <group position={position}>
      {/* Outer glow shell */}
      <mesh scale={scale * 1.4}>
        <boxGeometry args={[1.2, 0.7, 0.5]} />
        <meshStandardMaterial
          color={emissiveColor}
          emissive={emissiveColor}
          emissiveIntensity={active ? 0.3 : hovered ? 0.1 : 0.03}
          transparent
          opacity={active ? 0.08 : 0.03}
          depthWrite={false}
        />
      </mesh>

      {/* Main rounded box */}
      <RoundedBox
        args={[1.0, 0.55, 0.35]}
        radius={0.12}
        smoothness={4}
        scale={scale}
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
      >
        <meshStandardMaterial
          color={baseColor}
          emissive={emissiveColor}
          emissiveIntensity={emissiveIntensity}
          roughness={0.35}
          metalness={0.5}
        />
      </RoundedBox>

      {/* V3: Initial state marker - green arrow cone pointing in from left */}
      {isInitial && (
        <group position={[-0.75, 0, 0]}>
          <mesh rotation={[0, 0, -Math.PI / 2]}>
            <coneGeometry args={[0.12, 0.25, 8]} />
            <meshStandardMaterial
              color={palette.stateActive}
              emissive={palette.stateActive}
              emissiveIntensity={1.0}
            />
          </mesh>
          {/* Small connecting line */}
          <mesh position={[-0.2, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.02, 0.02, 0.25, 6]} />
            <meshStandardMaterial
              color={palette.stateActive}
              emissive={palette.stateActive}
              emissiveIntensity={0.6}
            />
          </mesh>
        </group>
      )}

      {/* V3: Terminal state marker - red octahedron to the right */}
      {isTerminal && (
        <group position={[0.75, 0, 0]}>
          <mesh scale={0.15}>
            <octahedronGeometry args={[1, 0]} />
            <meshStandardMaterial
              color={palette.guardFail}
              emissive={palette.guardFail}
              emissiveIntensity={1.0}
            />
          </mesh>
          {/* Double border ring around octahedron */}
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.2, 0.015, 8, 24]} />
            <meshStandardMaterial
              color={palette.guardFail}
              emissive={palette.guardFail}
              emissiveIntensity={0.5}
            />
          </mesh>
        </group>
      )}

      {/* Active state point light */}
      {active && (
        <pointLight
          color={palette.stateActive}
          intensity={1.5}
          distance={4}
          decay={2}
        />
      )}

      {/* State name label */}
      <Avl3DLabel
        position={[0, -0.55, 0]}
        text={name}
        color={active ? palette.stateActive : AVL_INK.text}
        fontSize={11}
      />

      {/* Hover tooltip */}
      {hovered && (
        <Avl3DTooltip
          position={[0.9, 0.3, 0]}
          title={name}
          accentColor={active ? AVL_3D_COLORS.stateActive : AVL_3D_COLORS.stateEdge}
          rows={[
            { label: t('avl3d.type'), value: isInitial ? t('avl3d.typeInitial') : isTerminal ? t('avl3d.typeTerminal') : t('avl3d.typeStandard') },
            { label: t('avl3d.incoming'), value: String(incomingCount) },
            { label: t('avl3d.outgoing'), value: String(outgoingCount) },
            ...(active ? [{ label: t('avl3d.status'), value: t('status.active') }] : []),
          ]}
        />
      )}
    </group>
  );
};

Avl3DStateNode.displayName = 'Avl3DStateNode';
