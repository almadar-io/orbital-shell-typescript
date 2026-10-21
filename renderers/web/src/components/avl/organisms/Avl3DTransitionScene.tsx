'use client';

/**
 * Avl3DTransitionScene - 3D expression tree and effect chain view.
 *
 * Renders a detailed view of a single transition with its guard
 * expression tree and effect chain. The 3D equivalent of AvlTransitionScene.
 *
 * @packageDocumentation
 */

import React from 'react';
import { useTranslate } from '../../../core';
import type { TransitionLevelData } from '../../../lib/avl-schema-parser';
import { useAvl3DPalette } from '../../../providers/avl-3d-context';
import { Avl3DStateNode } from '../molecules/Avl3DStateNode';
import { Avl3DExprTree } from '../molecules/Avl3DExprTree';
import { Avl3DLabel } from '../atoms/Avl3DLabel';
import { AVL_INK } from '../../../lib/avl-theme';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface Avl3DTransitionSceneProps {
  /** Parsed transition-level data */
  data: TransitionLevelData;
  /** Primary color */
  color?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const Avl3DTransitionScene: React.FC<Avl3DTransitionSceneProps> = ({
  data,
}) => {
  const palette = useAvl3DPalette();
  const { t, locale } = useTranslate();
  if (!palette) return null;

  return (
    <group>
      {/* From state (top) */}
      <Avl3DStateNode
        name={data.from}
        position={[0, 4, 0]}
      />

      {/* Event box */}
      <group position={[0, 2.2, 0]}>
        <mesh>
          <boxGeometry args={[2, 0.6, 0.4]} />
          <meshStandardMaterial
            color={palette.transitionArc}
            emissive={palette.transitionArc}
            emissiveIntensity={0.5}
            roughness={0.3}
          />
        </mesh>
        <Avl3DLabel
          position={[0, 0, 0.3]}
          text={data.event}
          color={AVL_INK.text}
          fontSize={13}
        />
      </group>

      {/* Connecting line: from state -> event */}
      <mesh position={[0, 3.1, 0]}>
        <cylinderGeometry args={[0.02, 0.02, 1.2, 6]} />
        <meshStandardMaterial color={palette.transitionArc} transparent opacity={0.5} />
      </mesh>

      {/* Guard gate (if guard exists) */}
      {data.guard && (
        <group position={[0, 1, 0]}>
          {/* Diamond shape */}
          <mesh rotation={[0, 0, Math.PI / 4]}>
            <boxGeometry args={[0.5, 0.5, 0.3]} />
            <meshStandardMaterial
              color={palette.guardPass}
              emissive={palette.guardPass}
              emissiveIntensity={0.6}
            />
          </mesh>

          {/* Connecting line: event -> guard */}
          <mesh position={[0, 0.7, 0]}>
            <cylinderGeometry args={[0.02, 0.02, 0.8, 6]} />
            <meshStandardMaterial color={palette.transitionArc} transparent opacity={0.5} />
          </mesh>

          {/* Guard expression tree (to the right) */}
          <Avl3DExprTree
            expression={data.guard}
            position={[3, 0, 0]}
          />

          {/* Label linking guard to tree */}
          <Avl3DLabel
            position={[1.5, 0.3, 0]}
            text={t('avl.guard').toLocaleLowerCase(locale)}
            color={palette.guardPass}
            fontSize={9}
          />
        </group>
      )}

      {/* Effects */}
      {data.effects.length > 0 && (
        <group position={[0, data.guard ? -0.5 : 0.5, 0]}>
          <Avl3DLabel
            position={[0, 0.4, 0]}
            text={t(data.effects.length === 1 ? 'avl3d.effectCountOne' : 'avl3d.effectCountOther', { count: data.effects.length })}
            color={AVL_INK.caution}
            fontSize={10}
          />

          {/* Effect expression trees (spread horizontally) */}
          {data.effects.map((effect, i) => {
            const xOffset = (i - (data.effects.length - 1) / 2) * 3;
            return (
              <Avl3DExprTree
                key={i}
                expression={effect}
                position={[xOffset, -1, 0]}
              />
            );
          })}
        </group>
      )}

      {/* Connecting line to target state */}
      <mesh position={[0, data.guard ? -2.5 : -1.5, 0]}>
        <cylinderGeometry args={[0.02, 0.02, 1.2, 6]} />
        <meshStandardMaterial color={palette.transitionArc} transparent opacity={0.5} />
      </mesh>

      {/* To state (bottom) */}
      <Avl3DStateNode
        name={data.to}
        position={[0, data.guard ? -3.5 : -2.5, 0]}
      />
    </group>
  );
};

Avl3DTransitionScene.displayName = 'Avl3DTransitionScene';
