'use client';

/**
 * Avl3DLabel - Billboard text label for 3D AVL visualizations.
 *
 * Uses drei's Html component to render text that always faces the camera.
 *
 * @packageDocumentation
 */

import React from 'react';
import { Html } from '@react-three/drei';
import { Typography } from '../../../core';
import { AVL_INK, avlTint } from '../../../lib/avl-theme';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface Avl3DLabelProps {
  /** 3D position [x, y, z] */
  position: [number, number, number];
  /** Label text */
  text: string;
  /** Text color (CSS) */
  color?: string;
  /** Font size in px */
  fontSize?: number;
  /** CSS class */
  className?: string;
  /** Hide label when behind other objects */
  occlude?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const Avl3DLabel: React.FC<Avl3DLabelProps> = ({
  position,
  text,
  color = AVL_INK.text,
  fontSize = 12,
  className,
  occlude = false,
}) => {
  return (
    <Html
      position={position}
      center
      distanceFactor={10}
      occlude={occlude ? 'blending' : undefined}
      className={className}
      style={{ pointerEvents: 'none' }}
    >
      <Typography
        variant="small"
        style={{
          color,
          fontSize: `${fontSize}px`,
          whiteSpace: 'nowrap',
          textShadow: `0 0 4px ${avlTint(AVL_INK.canvas, 80)}`,
          userSelect: 'none',
        }}
      >
        {text}
      </Typography>
    </Html>
  );
};

Avl3DLabel.displayName = 'Avl3DLabel';
