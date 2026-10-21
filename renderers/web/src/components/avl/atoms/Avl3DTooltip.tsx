'use client';

/**
 * Avl3DTooltip - Styled tooltip card for 3D AVL hover info.
 *
 * Uses drei's Html to render a DOM card in 3D space that always
 * faces the camera. Shows contextual info based on the hovered node.
 *
 * @packageDocumentation
 */

import React from 'react';
import { Html } from '@react-three/drei';
import { Box } from '../../../core';
import { Typography } from '../../../core';
import { VStack } from '../../../core';
import { AVL_INK, avlTint } from '../../../lib/avl-theme';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface Avl3DTooltipProps {
  /** 3D position [x, y, z] */
  position: [number, number, number];
  /** Tooltip title (bold, top line) */
  title: string;
  /** Key-value rows to display */
  rows: Array<{ label: string; value: string }>;
  /** Optional accent color for the left border */
  accentColor?: string;
  /** CSS class */
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const Avl3DTooltip: React.FC<Avl3DTooltipProps> = ({
  position,
  title,
  rows,
  accentColor = AVL_INK.focus,
}) => {
  return (
    <Html
      position={position}
      center
      distanceFactor={8}
      style={{ pointerEvents: 'none' }}
      zIndexRange={[100, 0]}
    >
      <Box
        style={{
          background: avlTint(AVL_INK.surface, 92),
          backdropFilter: 'blur(8px)',
          borderLeft: `3px solid ${accentColor}`,
          borderRadius: '6px',
          padding: '8px 12px',
          minWidth: '140px',
          maxWidth: '220px',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <VStack gap="xs">
          <Typography
            variant="small"
            style={{
              color: AVL_INK.text,
              fontWeight: 600,
              fontSize: '12px',
              lineHeight: 1.3,
            }}
          >
            {title}
          </Typography>

          {rows.map((row) => (
            <Box
              key={row.label}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: '12px',
              }}
            >
              <Typography
                variant="small"
                style={{
                  color: AVL_INK.quiet,
                  fontSize: '10px',
                  whiteSpace: 'nowrap',
                }}
              >
                {row.label}
              </Typography>
              <Typography
                variant="small"
                style={{
                  color: AVL_INK.text,
                  fontSize: '10px',
                  fontWeight: 500,
                  textAlign: 'right',
                }}
              >
                {row.value}
              </Typography>
            </Box>
          ))}
        </VStack>
      </Box>
    </Html>
  );
};

Avl3DTooltip.displayName = 'Avl3DTooltip';
