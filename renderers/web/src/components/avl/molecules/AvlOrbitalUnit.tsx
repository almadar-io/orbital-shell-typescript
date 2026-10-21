'use client';

import React from 'react';
import { AvlEntity } from '../atoms/AvlEntity';
import { AvlTrait } from '../atoms/AvlTrait';
import { AvlPage } from '../atoms/AvlPage';
import { AvlOrbital } from '../atoms/AvlOrbital';
import { type EntityPersistence } from '@almadar/core';

export interface AvlOrbitalUnitTrait {
  name: string;
  color?: string;
}

export interface AvlOrbitalUnitPage {
  name: string;
}

export interface AvlOrbitalUnitProps {
  entityName: string;
  fields?: number;
  persistence?: EntityPersistence;
  traits: AvlOrbitalUnitTrait[];
  pages: AvlOrbitalUnitPage[];
  className?: string;
  color?: string;
  animated?: boolean;
}

let avlOuId = 0;

export const AvlOrbitalUnit: React.FC<AvlOrbitalUnitProps> = ({
  entityName,
  fields = 4,
  persistence = 'persistent',
  traits,
  pages,
  className,
  color = 'var(--color-primary)',
  animated = false,
}) => {
  const ids = React.useMemo(() => {
    avlOuId += 1;
    const base = `avl-ou-${avlOuId}`;
    return { glow: `${base}-glow`, grad: `${base}-grad` };
  }, []);

  const cx = 300;
  const cy = 200;
  const entityR = 24;
  const orbitalR = 130;

  // Distribute trait rings with wider angular separation and size steps
  const traitBaseRx = 55;
  const traitBaseRy = 24;
  const traitRxStep = 20;
  const traitRyStep = 8;
  const traitAngleStep = traits.length > 1 ? 120 / (traits.length - 1) : 0;
  const traitAngleStart = traits.length > 1 ? -60 : 0;

  // Spread pages around the right side of the orbital boundary
  const pageAngleStart = -Math.PI / 3;
  const pageAngleStep = pages.length > 1 ? (Math.PI * 0.8) / (pages.length - 1) : 0;

  return (
    <svg viewBox="0 0 600 400" xmlns="http://www.w3.org/2000/svg" className={className}>
      <defs>
        <filter id={ids.glow} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <radialGradient id={ids.grad} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={color} stopOpacity={0.08} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </radialGradient>
      </defs>

      {animated && (
        <style>{`
          @keyframes avl-ou-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        `}</style>
      )}

      {/* Background glow */}
      <circle cx={cx} cy={cy} r={orbitalR + 20} fill={`url(#${ids.grad})`} />

      {/* Orbital boundary */}
      <AvlOrbital cx={cx} cy={cy} r={orbitalR} label={entityName} color={color} />

      {/* Trait rings - wider spread to avoid label overlap */}
      {traits.map((trait, i) => {
        const rotation = traitAngleStart + i * traitAngleStep;
        const traitColor = trait.color ?? color;
        return (
          <AvlTrait
            key={trait.name}
            cx={cx}
            cy={cy}
            rx={traitBaseRx + i * traitRxStep}
            ry={traitBaseRy + i * traitRyStep}
            rotation={rotation}
            label={trait.name}
            color={traitColor}
            opacity={0.7}
          />
        );
      })}

      {/* Entity nucleus */}
      <AvlEntity
        x={cx}
        y={cy}
        r={entityR}
        fieldCount={fields}
        persistence={persistence}
        color={color}
      />

      {/* Page squares on boundary */}
      {pages.map((page, i) => {
        const angle = pageAngleStart + i * pageAngleStep;
        const px = cx + orbitalR * Math.cos(angle);
        const py = cy + orbitalR * Math.sin(angle);
        return (
          <AvlPage
            key={page.name}
            x={px}
            y={py}
            size={10}
            label={page.name}
            color={color}
          />
        );
      })}
    </svg>
  );
};

AvlOrbitalUnit.displayName = 'AvlOrbitalUnit';
