'use client';

/**
 * Avl3DTransitionArc - Curved tube between two state nodes.
 *
 * Renders a tube geometry along a Bezier curve with optional guard gate
 * and arrowhead cone. The 3D equivalent of SVG transition arrows.
 *
 * @packageDocumentation
 */

import React, { useMemo, useState } from 'react';
import { Quaternion, Vector3 } from 'three';
import { arcCurve3D, effectTypePaletteKey, selfLoopCurve3D } from '../../../lib/avl-3d-layout';
import { useAvl3DPalette } from '../../../providers/avl-3d-context';
import { useTranslate } from '../../../core';
import { Avl3DLabel } from '../atoms/Avl3DLabel';
import { Avl3DTooltip } from '../atoms/Avl3DTooltip';
import { AVL_INK } from '../../../lib/avl-theme';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface Avl3DTransitionArcProps {
  /** Start position [x, y, z] */
  from: [number, number, number];
  /** End position [x, y, z] */
  to: [number, number, number];
  /** Event name */
  event: string;
  /** Whether this transition has a guard */
  hasGuard?: boolean;
  /** Number of effects */
  effectCount: number;
  /** Effect type names for V4 micro-icons */
  effectTypes?: string[];
  /** Index (for fanning parallel transitions) */
  index: number;
  /** Whether this is a self-transition */
  isSelf?: boolean;
  /** Source state name (for tooltip) */
  fromState?: string;
  /** Target state name (for tooltip) */
  toState?: string;
  /** Click handler */
  onClick?: () => void;
  /** Color override */
  color?: string;
  /** CSS class */
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const Avl3DTransitionArc: React.FC<Avl3DTransitionArcProps> = ({
  from,
  to,
  event,
  hasGuard = false,
  effectTypes,
  index,
  isSelf = false,
  fromState,
  toState,
  onClick,
  color,
}) => {
  const [hovered, setHovered] = useState(false);
  const palette = useAvl3DPalette();
  const { t } = useTranslate();

  const { tubeArgs, labelPos, guardPos, arrowPos, arrowQuat, effectPositions } = useMemo(() => {
    const offset = 1.5 + index * 0.8;
    const curve = isSelf
      ? selfLoopCurve3D(from, 1.2)
      : arcCurve3D(from, to, offset);

    const mid = curve.getPoint(0.5);
    const guardPt = curve.getPoint(0.3);
    const arrowPt = curve.getPoint(0.9);
    const arrowTangent = curve.getTangent(0.9);

    // Compute quaternion to align cone (default Y-up) with tangent direction
    const upVec = new Vector3(0, 1, 0);
    const tangentVec = new Vector3(arrowTangent.x, arrowTangent.y, arrowTangent.z).normalize();
    const quat = new Quaternion().setFromUnitVectors(upVec, tangentVec);

    // V4: Precompute effect icon positions along curve
    const effectPositions: [number, number, number][] = [];
    for (let ei = 0; ei < 4; ei++) {
      const t = 0.7 + ei * 0.05;
      const ep = curve.getPoint(t);
      effectPositions.push([ep.x, ep.y + 0.2, ep.z]);
    }

    return {
      tubeArgs: [curve, 48, 0.02, 8, false] as const,
      labelPos: [mid.x, mid.y + 0.3, mid.z] as [number, number, number],
      guardPos: [guardPt.x, guardPt.y, guardPt.z] as [number, number, number],
      arrowPos: [arrowPt.x, arrowPt.y, arrowPt.z] as [number, number, number],
      arrowQuat: [quat.x, quat.y, quat.z, quat.w] as [number, number, number, number],
      effectPositions,
    };
  }, [from, to, index, isSelf]);

  const emissiveIntensity = hovered ? 0.8 : 0.4;

  if (!palette) return null;

  const arcColor = color ?? palette.transitionArc;

  return (
    <group>
      {/* Tube along curve */}
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
      >
        <tubeGeometry args={[tubeArgs[0], tubeArgs[1], tubeArgs[2], tubeArgs[3], tubeArgs[4]]} />
        <meshStandardMaterial
          color={arcColor}
          emissive={arcColor}
          emissiveIntensity={emissiveIntensity}
          transparent
          opacity={hovered ? 0.9 : 0.7}
        />
      </mesh>

      {/* Guard gate (octahedron at 30% along curve) */}
      {hasGuard && (
        <mesh position={guardPos} scale={0.15}>
          <octahedronGeometry args={[1, 0]} />
          <meshStandardMaterial
            color={palette.guardPass}
            emissive={palette.guardPass}
            emissiveIntensity={0.8}
          />
        </mesh>
      )}

      {/* Arrowhead cone at 90% along curve, rotated to face tangent */}
      <mesh
        position={arrowPos}
        quaternion={arrowQuat}
        scale={0.08}
      >
        <coneGeometry args={[1, 2, 8]} />
        <meshStandardMaterial
          color={arcColor}
          emissive={arcColor}
          emissiveIntensity={0.6}
        />
      </mesh>

      {/* Event label at midpoint */}
      <Avl3DLabel
        position={labelPos}
        text={event}
        color={hovered ? AVL_INK.text : arcColor}
        fontSize={hovered ? 11 : 9}
      />

      {/* Hover tooltip */}
      {hovered && (
        <Avl3DTooltip
          position={[labelPos[0], labelPos[1] + 0.6, labelPos[2]]}
          title={event}
          accentColor={arcColor}
          rows={[
            ...(fromState && toState ? [{ label: t('avl.transition'), value: `${fromState} → ${toState}` }] : []),
            ...(hasGuard ? [{ label: t('avl.guard'), value: t('common.yes') }] : []),
            ...(effectTypes && effectTypes.length > 0
              ? [{ label: t('avl.effects'), value: effectTypes.slice(0, 3).join(', ') + (effectTypes.length > 3 ? ` +${effectTypes.length - 3}` : '') }]
              : []),
          ]}
        />
      )}

      {/* V4: Effect type micro-icons near target (70-85% along curve) */}
      {effectTypes && effectTypes.length > 0 && effectTypes.slice(0, 4).map((effectType, ei) => {
        const pt = effectPositions[ei];
        if (!pt) return null;
        const eColor = palette[effectTypePaletteKey(effectType)];
        return (
          <group key={ei} position={pt}>
            <mesh scale={0.06}>
              {effectType === 'render-ui' ? (
                <boxGeometry args={[1.5, 1.5, 0.3]} />
              ) : effectType === 'persist' ? (
                <cylinderGeometry args={[0.6, 0.6, 1.5, 8]} />
              ) : effectType === 'emit' ? (
                <sphereGeometry args={[1, 8, 8]} />
              ) : effectType === 'navigate' ? (
                <coneGeometry args={[0.8, 1.5, 6]} />
              ) : effectType === 'set' ? (
                <tetrahedronGeometry args={[1, 0]} />
              ) : effectType === 'call-service' ? (
                <torusGeometry args={[0.8, 0.3, 6, 12]} />
              ) : (
                <octahedronGeometry args={[0.8, 0]} />
              )}
              <meshStandardMaterial
                color={eColor}
                emissive={eColor}
                emissiveIntensity={0.8}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
};

Avl3DTransitionArc.displayName = 'Avl3DTransitionArc';
